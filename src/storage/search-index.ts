import { createHash } from "node:crypto";

export interface GitHubRecordPath {
  path: string;
  sha: string;
}

export interface SearchIndexEntry {
  sha: string;
  bloom: string;
}

export interface SearchIndexV1 {
  version: 1;
  bloomBytes: number;
  hashCount: number;
  records: Record<string, SearchIndexEntry>;
}

export interface SearchIndexShardV2 {
  version: 2;
  bloomBytes: number;
  hashCount: number;
  key: string;
  records: Record<string, SearchIndexEntry>;
}

export interface SearchIndexManifestV2 {
  version: 2;
  bloomBytes: number;
  hashCount: number;
  shards: Record<string, {
    path: string;
    recordCount: number;
    recordsDigest: string;
  }>;
}

export const SEARCH_INDEX_V1_PATH = ".capture-reflect/search-index-v1.json";
export const SEARCH_INDEX_V2_MANIFEST_PATH = ".capture-reflect/index-v2/manifest.json";
export const SEARCH_INDEX_V2_PREFIX = ".capture-reflect/index-v2/";
export const SEARCH_METADATA_README_PATH = ".capture-reflect/README.md";
export const SEARCH_METADATA_README = `# Capture & Reflect metadata

This folder is managed by Capture & Reflect. Your Markdown files under \`journals/\`, \`notes/\`, and \`reviews/\` remain the source of truth.

\`index-v2/\` contains sharded record paths, Git blob SHAs, and Bloom filters that make private-repository search faster. A legacy \`search-index-v1.json\` may remain during migration. These files do not contain a second copy of your journal or note text.

Do not edit this folder manually. It is safe to delete the search index if necessary; a later search can rebuild it from the Markdown records.
`;
export const SEARCH_INDEX_VERSION_V1 = 1 as const;
export const SEARCH_INDEX_VERSION_V2 = 2 as const;
export const BLOOM_BYTES = 512;
export const BLOOM_HASH_COUNT = 4;
const BLOOM_BITS = BLOOM_BYTES * 8;
const TRIGRAM_SIZE = 3;

export function trigrams(value: string): string[] {
  const characters = Array.from(value.toLocaleLowerCase());
  if (characters.length < TRIGRAM_SIZE) return [];
  const grams = new Set<string>();
  for (let index = 0; index <= characters.length - TRIGRAM_SIZE; index += 1) {
    grams.add(characters.slice(index, index + TRIGRAM_SIZE).join(""));
  }
  return [...grams];
}

function hash32(value: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function bloomPositions(value: string): number[] {
  const first = hash32(value, 0x9e3779b9);
  const second = (hash32(value, 0x7f4a7c15) | 1) >>> 0;
  return Array.from({ length: BLOOM_HASH_COUNT }, (_, index) =>
    ((first + Math.imul(index, second)) >>> 0) % BLOOM_BITS,
  );
}

export function buildBloom(content: string): string {
  const bytes = Buffer.alloc(BLOOM_BYTES);
  for (const gram of trigrams(content)) {
    for (const position of bloomPositions(gram)) {
      const byteIndex = Math.floor(position / 8);
      bytes[byteIndex] = bytes[byteIndex]! | (1 << (position % 8));
    }
  }
  return bytes.toString("base64");
}

export function bloomMayContain(bloom: string, grams: string[]): boolean {
  if (grams.length === 0) return true;
  const bytes = Buffer.from(bloom, "base64");
  if (bytes.length !== BLOOM_BYTES) return true;
  return grams.every((gram) =>
    bloomPositions(gram).every((position) => {
      const byte = bytes[Math.floor(position / 8)]!;
      return (byte & (1 << (position % 8))) !== 0;
    }),
  );
}

function validEntry(value: unknown): value is SearchIndexEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SearchIndexEntry>;
  return (
    typeof entry.sha === "string" &&
    typeof entry.bloom === "string" &&
    Buffer.from(entry.bloom, "base64").length === BLOOM_BYTES
  );
}

function validEntries(value: unknown): value is Record<string, SearchIndexEntry> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(validEntry)
  );
}

export function validSearchIndexV1(value: unknown): value is SearchIndexV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchIndexV1>;
  return (
    candidate.version === SEARCH_INDEX_VERSION_V1 &&
    candidate.bloomBytes === BLOOM_BYTES &&
    candidate.hashCount === BLOOM_HASH_COUNT &&
    validEntries(candidate.records)
  );
}

export function validSearchIndexShardV2(value: unknown): value is SearchIndexShardV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchIndexShardV2>;
  return (
    candidate.version === SEARCH_INDEX_VERSION_V2 &&
    candidate.bloomBytes === BLOOM_BYTES &&
    candidate.hashCount === BLOOM_HASH_COUNT &&
    typeof candidate.key === "string" &&
    validEntries(candidate.records)
  );
}

export function validSearchIndexManifestV2(value: unknown): value is SearchIndexManifestV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchIndexManifestV2>;
  if (
    candidate.version !== SEARCH_INDEX_VERSION_V2 ||
    candidate.bloomBytes !== BLOOM_BYTES ||
    candidate.hashCount !== BLOOM_HASH_COUNT ||
    !candidate.shards ||
    typeof candidate.shards !== "object"
  ) {
    return false;
  }
  return Object.entries(candidate.shards).every(([key, shard]) => (
    Boolean(shard) &&
    typeof shard.path === "string" &&
    shard.path === shardPath(key) &&
    Number.isSafeInteger(shard.recordCount) &&
    shard.recordCount >= 0 &&
    typeof shard.recordsDigest === "string"
  ));
}

export function shardKeyForPath(path: string): string {
  const parts = path.split("/");
  const type = parts[0];
  const year = parts[1];
  if (
    (type === "journals" || type === "notes" || type === "reviews") &&
    /^\d{4}$/.test(year ?? "")
  ) {
    return `${type}/${year}`;
  }
  const bucket = createHash("sha256").update(path, "utf8").digest("hex").slice(0, 1);
  return `${type || "other"}/_legacy/${bucket}`;
}

export function shardPath(key: string): string {
  return `${SEARCH_INDEX_V2_PREFIX}${key}.json`;
}

export function recordsDigest(records: GitHubRecordPath[]): string {
  const canonical = [...records]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path, sha }) => `${path}\0${sha}\n`)
    .join("");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function groupRecordPaths(records: GitHubRecordPath[]): Map<string, GitHubRecordPath[]> {
  const groups = new Map<string, GitHubRecordPath[]>();
  for (const record of records) {
    const key = shardKeyForPath(record.path);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

export function buildShardedIndex(
  entries: Record<string, SearchIndexEntry>,
): { manifest: SearchIndexManifestV2; shards: Map<string, SearchIndexShardV2> } {
  const grouped = new Map<string, Record<string, SearchIndexEntry>>();
  for (const [path, entry] of Object.entries(entries)) {
    const key = shardKeyForPath(path);
    const records = grouped.get(key) ?? {};
    records[path] = entry;
    grouped.set(key, records);
  }

  const shards = new Map<string, SearchIndexShardV2>();
  const manifestShards: SearchIndexManifestV2["shards"] = {};
  for (const [key, records] of [...grouped.entries()].sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ))) {
    const shard: SearchIndexShardV2 = {
      version: SEARCH_INDEX_VERSION_V2,
      bloomBytes: BLOOM_BYTES,
      hashCount: BLOOM_HASH_COUNT,
      key,
      records,
    };
    shards.set(key, shard);
    const paths = Object.entries(records).map(([path, entry]) => ({ path, sha: entry.sha }));
    manifestShards[key] = {
      path: shardPath(key),
      recordCount: paths.length,
      recordsDigest: recordsDigest(paths),
    };
  }
  return {
    manifest: {
      version: SEARCH_INDEX_VERSION_V2,
      bloomBytes: BLOOM_BYTES,
      hashCount: BLOOM_HASH_COUNT,
      shards: manifestShards,
    },
    shards,
  };
}

export function manifestMatchesRecords(
  manifest: SearchIndexManifestV2,
  records: GitHubRecordPath[],
): boolean {
  const groups = groupRecordPaths(records);
  if (groups.size !== Object.keys(manifest.shards).length) return false;
  for (const [key, group] of groups) {
    const shard = manifest.shards[key];
    if (
      !shard ||
      shard.path !== shardPath(key) ||
      shard.recordCount !== group.length ||
      shard.recordsDigest !== recordsDigest(group)
    ) {
      return false;
    }
  }
  return true;
}

export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
