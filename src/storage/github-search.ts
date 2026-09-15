import {
  assertDate,
  recordDateFromPath,
} from "./record-utils.js";
import type {
  RecordsStore,
  RecordType,
  StoredRecord,
} from "./records-store.js";

interface FastGitHubSearchOptions {
  repository: string;
  token: string;
  branch?: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface GitHubTree {
  truncated: boolean;
  tree: Array<{ path?: string; type?: string; sha?: string }>;
}

interface GitHubRecordPath {
  path: string;
  sha: string;
}

interface GitHubGraphQlBlob {
  oid: string;
  text: string | null;
}

interface GitHubGraphQlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
  message?: string;
}

interface GitHubBlob {
  content: string;
  encoding: string;
  sha: string;
}

interface SearchIndexEntry {
  sha: string;
  bloom: string;
}

interface SearchIndex {
  version: 1;
  bloomBytes: number;
  hashCount: number;
  records: Record<string, SearchIndexEntry>;
}

const GRAPHQL_BLOB_BATCH_SIZE = 100;
const GRAPHQL_BATCH_CONCURRENCY = 6;
const SEARCH_INDEX_PATH = ".capture-reflect/search-index-v1.json";
const SEARCH_INDEX_VERSION = 1 as const;
const BLOOM_BYTES = 512;
const BLOOM_BITS = BLOOM_BYTES * 8;
const BLOOM_HASH_COUNT = 4;
const TRIGRAM_SIZE = 3;

function recordTypeFromPath(path: string): RecordType {
  if (path.startsWith("journals/")) return "journal";
  if (path.startsWith("reviews/")) return "review";
  return "note";
}

function repositoryParts(repository: string): { owner: string; name: string; encoded: string } {
  const parts = repository.trim().split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("GitHub repository must use the owner/name format.");
  }
  return {
    owner: parts[0]!,
    name: parts[1]!,
    encoded: parts.map(encodeURIComponent).join("/"),
  };
}

function encodedPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function trigrams(value: string): string[] {
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

function buildBloom(content: string): string {
  const bytes = Buffer.alloc(BLOOM_BYTES);
  for (const gram of trigrams(content)) {
    for (const position of bloomPositions(gram)) {
      const byteIndex = Math.floor(position / 8);
      bytes[byteIndex] = bytes[byteIndex]! | (1 << (position % 8));
    }
  }
  return bytes.toString("base64");
}

function bloomMayContain(bloom: string, grams: string[]): boolean {
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

function validSearchIndex(value: unknown): value is SearchIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SearchIndex>;
  if (
    candidate.version !== SEARCH_INDEX_VERSION ||
    candidate.bloomBytes !== BLOOM_BYTES ||
    candidate.hashCount !== BLOOM_HASH_COUNT ||
    !candidate.records ||
    typeof candidate.records !== "object"
  ) {
    return false;
  }
  return Object.values(candidate.records).every(
    (entry) =>
      Boolean(entry) &&
      typeof entry.sha === "string" &&
      typeof entry.bloom === "string" &&
      Buffer.from(entry.bloom, "base64").length === BLOOM_BYTES,
  );
}

class FastGitHubSearch {
  readonly #owner: string;
  readonly #name: string;
  readonly #repositoryPath: string;
  readonly #token: string;
  readonly #branch: string;
  readonly #apiBaseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: FastGitHubSearchOptions) {
    const repository = repositoryParts(options.repository);
    if (!options.token.trim()) throw new Error("GitHub token must not be empty.");
    this.#owner = repository.owner;
    this.#name = repository.name;
    this.#repositoryPath = repository.encoded;
    this.#token = options.token.trim();
    this.#branch = options.branch?.trim() || "main";
    this.#apiBaseUrl = `${(options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "")}/`;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async search(options: {
    query: string;
    from?: string;
    to?: string;
    types?: RecordType[];
    limit?: number;
  }): Promise<Array<StoredRecord & { excerpts: string[] }>> {
    const query = options.query.trim().toLocaleLowerCase();
    if (!query) throw new Error("query must not be empty.");

    const from = options.from ?? "0001-01-01";
    const to = options.to ?? "9999-12-31";
    assertDate(from);
    assertDate(to);
    if (from > to) throw new Error("from must be on or before to.");

    const requested = new Set(options.types ?? ["journal", "note"]);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const tree = await this.#listTree();
    const synced = await this.#syncIndex(tree.records, tree.indexSha);
    const queryGrams = trigrams(query);

    const candidates = tree.records
      .filter(({ path }) => {
        const date = recordDateFromPath(path);
        if (
          !date ||
          date < from ||
          date > to ||
          !requested.has(recordTypeFromPath(path))
        ) {
          return false;
        }
        const entry = synced.index.records[path];
        return Boolean(entry && bloomMayContain(entry.bloom, queryGrams));
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    return this.#searchExact(candidates, query, limit, synced.refreshed);
  }

  async #listTree(): Promise<{ records: GitHubRecordPath[]; indexSha?: string }> {
    const response = await this.#fetch(
      new URL(
        `repos/${this.#repositoryPath}/git/trees/${encodeURIComponent(this.#branch)}?recursive=1`,
        this.#apiBaseUrl,
      ),
      {
        method: "GET",
        headers: this.#headers(),
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        `GitHub API GET failed (${response.status}): ${payload.message ?? response.statusText}`,
      );
    }
    const tree = (await response.json()) as GitHubTree;
    if (tree.truncated) {
      throw new Error("The GitHub repository tree is too large to search safely.");
    }

    let indexSha: string | undefined;
    const records: GitHubRecordPath[] = [];
    for (const item of tree.tree) {
      if (item.type !== "blob" || !item.path || !item.sha) continue;
      if (item.path === SEARCH_INDEX_PATH) {
        indexSha = item.sha;
        continue;
      }
      if (
        item.path.endsWith(".md") &&
        (item.path.startsWith("journals/") ||
          item.path.startsWith("notes/") ||
          item.path.startsWith("reviews/"))
      ) {
        records.push({ path: item.path, sha: item.sha });
      }
    }
    return {
      records,
      ...(indexSha ? { indexSha } : {}),
    };
  }

  async #syncIndex(
    records: GitHubRecordPath[],
    indexSha?: string,
  ): Promise<{
    index: SearchIndex;
    refreshed: Map<string, StoredRecord>;
  }> {
    const existing = indexSha ? await this.#loadIndex(indexSha) : undefined;
    const previous = existing?.records ?? {};
    const nextRecords: Record<string, SearchIndexEntry> = {};
    const changed: GitHubRecordPath[] = [];

    for (const record of records) {
      const entry = previous[record.path];
      if (entry?.sha === record.sha) {
        nextRecords[record.path] = entry;
      } else {
        changed.push(record);
      }
    }

    const refreshed = await this.#readRecords(changed);
    for (const record of changed) {
      const content = refreshed.get(record.path)?.content;
      if (content === undefined) {
        throw new Error(`GitHub did not return record content for ${record.path}.`);
      }
      nextRecords[record.path] = {
        sha: record.sha,
        bloom: buildBloom(content),
      };
    }

    const index: SearchIndex = {
      version: SEARCH_INDEX_VERSION,
      bloomBytes: BLOOM_BYTES,
      hashCount: BLOOM_HASH_COUNT,
      records: nextRecords,
    };
    const deletedCount = Object.keys(previous).length - (records.length - changed.length);
    const needsSave = !existing || changed.length > 0 || deletedCount > 0;
    if (needsSave) {
      await this.#saveIndex(index, indexSha);
    }
    return { index, refreshed };
  }

  async #loadIndex(sha: string): Promise<SearchIndex | undefined> {
    const response = await this.#fetch(
      new URL(`repos/${this.#repositoryPath}/git/blobs/${encodeURIComponent(sha)}`, this.#apiBaseUrl),
      {
        method: "GET",
        headers: this.#headers(),
      },
    );
    if (!response.ok) return undefined;
    const blob = (await response.json()) as GitHubBlob;
    if (blob.encoding !== "base64" || blob.sha !== sha) return undefined;
    try {
      const parsed = JSON.parse(
        Buffer.from(blob.content.replaceAll("\n", ""), "base64").toString("utf8"),
      ) as unknown;
      return validSearchIndex(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async #saveIndex(index: SearchIndex, sha?: string): Promise<void> {
    const response = await this.#fetch(
      new URL(`repos/${this.#repositoryPath}/contents/${encodedPath(SEARCH_INDEX_PATH)}`, this.#apiBaseUrl),
      {
        method: "PUT",
        headers: this.#headers(),
        body: JSON.stringify({
          message: "capture-reflect: update search index",
          content: Buffer.from(JSON.stringify(index), "utf8").toString("base64"),
          branch: this.#branch,
          ...(sha ? { sha } : {}),
        }),
      },
    );
    if (response.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    console.warn(
      "[capture-reflect][search-index]",
      JSON.stringify({
        event: "save_failed",
        status: response.status,
        message: payload.message ?? response.statusText,
      }),
    );
  }

  async #searchExact(
    candidates: GitHubRecordPath[],
    query: string,
    limit: number,
    cached: Map<string, StoredRecord>,
  ): Promise<Array<StoredRecord & { excerpts: string[] }>> {
    const matches: Array<StoredRecord & { excerpts: string[] }> = [];
    const waveSize = GRAPHQL_BLOB_BATCH_SIZE * GRAPHQL_BATCH_CONCURRENCY;

    for (let offset = 0; offset < candidates.length; offset += waveSize) {
      const wave = candidates.slice(offset, offset + waveSize);
      const missing = wave.filter((record) => !cached.has(record.path));
      const fetched = await this.#readRecords(missing);
      for (const [path, record] of fetched) cached.set(path, record);

      for (const candidate of wave) {
        const record = cached.get(candidate.path);
        if (!record) throw new Error(`GitHub did not return record content for ${candidate.path}.`);
        const excerpts = record.content
          .split("\n")
          .filter((line) => line.toLocaleLowerCase().includes(query))
          .slice(0, 3);
        if (excerpts.length === 0) continue;
        matches.push({ ...record, excerpts });
        if (matches.length >= limit) return matches;
      }
    }
    return matches;
  }

  async #readRecords(records: GitHubRecordPath[]): Promise<Map<string, StoredRecord>> {
    const result = new Map<string, StoredRecord>();
    const batches: GitHubRecordPath[][] = [];
    for (let offset = 0; offset < records.length; offset += GRAPHQL_BLOB_BATCH_SIZE) {
      batches.push(records.slice(offset, offset + GRAPHQL_BLOB_BATCH_SIZE));
    }
    for (let offset = 0; offset < batches.length; offset += GRAPHQL_BATCH_CONCURRENCY) {
      const wave = batches.slice(offset, offset + GRAPHQL_BATCH_CONCURRENCY);
      const waveResults = await Promise.all(wave.map((batch) => this.#readBatch(batch)));
      for (const batchRecords of waveResults) {
        for (const record of batchRecords) result.set(record.path, record);
      }
    }
    return result;
  }

  async #readBatch(batch: GitHubRecordPath[]): Promise<StoredRecord[]> {
    if (batch.length === 0) return [];
    const variableDefinitions = batch
      .map((_, index) => `$oid${index}: GitObjectID!`)
      .join(", ");
    const selections = batch
      .map(
        (_, index) =>
          `blob${index}: object(oid: $oid${index}) { ... on Blob { oid text } }`,
      )
      .join("\n");
    const query = `query($owner: String!, $name: String!, ${variableDefinitions}) {
      repository(owner: $owner, name: $name) {
        ${selections}
      }
    }`;
    const variables: Record<string, string> = {
      owner: this.#owner,
      name: this.#name,
    };
    for (const [index, record] of batch.entries()) {
      variables[`oid${index}`] = record.sha;
    }

    const response = await this.#fetch(new URL("graphql", this.#apiBaseUrl), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json().catch(() => ({}))) as GitHubGraphQlEnvelope<{
      repository: Record<string, GitHubGraphQlBlob | null> | null;
    }>;
    if (!response.ok) {
      throw new Error(
        `GitHub GraphQL failed (${response.status}): ${payload.message ?? response.statusText}`,
      );
    }
    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL failed: ${payload.errors
          .map((error) => error.message ?? "Unknown error")
          .join("; ")}`,
      );
    }
    if (!payload.data?.repository) {
      throw new Error("GitHub GraphQL could not resolve the records repository.");
    }

    return batch.map(({ path, sha }, index): StoredRecord => {
      const blob = payload.data!.repository![`blob${index}`];
      if (!blob || blob.text === null) {
        throw new Error(`GitHub returned an unsupported blob response for ${path}.`);
      }
      if (blob.oid !== sha) {
        throw new Error(`GitHub returned an unexpected blob for ${path}.`);
      }
      return {
        path,
        date: recordDateFromPath(path)!,
        type: recordTypeFromPath(path),
        content: blob.text,
      };
    });
  }

  #headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.#token}`,
      "content-type": "application/json",
      "user-agent": "capture-reflect-mcp",
      "x-github-api-version": "2022-11-28",
    };
  }
}

export function withFastGitHubSearch(
  store: RecordsStore,
  options: FastGitHubSearchOptions,
): RecordsStore {
  const search = new FastGitHubSearch(options);
  return {
    captureJournal: (input) => store.captureJournal(input),
    captureNote: (input) => store.captureNote(input),
    saveReview: (input) => store.saveReview(input),
    getRecords: (input) => store.getRecords(input),
    searchRecords: (input) => search.search(input),
  };
}
