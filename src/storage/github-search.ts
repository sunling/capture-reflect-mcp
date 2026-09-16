import {
  assertDate,
  recordDateFromPath,
} from "./record-utils.js";
import type {
  RecordsStore,
  RecordType,
  StoredRecord,
} from "./records-store.js";
import {
  BLOOM_BYTES,
  BLOOM_HASH_COUNT,
  SEARCH_INDEX_V1_PATH,
  SEARCH_INDEX_V2_MANIFEST_PATH,
  SEARCH_INDEX_V2_PREFIX,
  SEARCH_METADATA_README,
  SEARCH_METADATA_README_PATH,
  bloomMayContain,
  buildBloom,
  buildShardedIndex,
  groupRecordPaths,
  manifestMatchesRecords,
  recordsDigest,
  shardKeyForPath,
  shardPath,
  trigrams,
  validSearchIndexManifestV2,
  validSearchIndexShardV2,
  validSearchIndexV1,
  type GitHubRecordPath,
  type SearchIndexEntry,
  type SearchIndexManifestV2,
  type SearchIndexShardV2,
} from "./search-index.js";

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

interface GitHubCommitLookup {
  sha: string;
  commit: { tree: { sha: string } };
}

interface SearchTreeSnapshot {
  records: GitHubRecordPath[];
  indexV1Sha?: string;
  manifestV2Sha?: string;
  shardV2Shas: Map<string, string>;
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

const GRAPHQL_BLOB_BATCH_SIZE = 100;
const GRAPHQL_BATCH_CONCURRENCY = 6;

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
    const synced = await this.#syncIndex(tree);
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
        const entry = synced.entries[path];
        return Boolean(entry && bloomMayContain(entry.bloom, queryGrams));
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    return this.#searchExact(candidates, query, limit, synced.refreshed);
  }

  async #listTree(): Promise<SearchTreeSnapshot> {
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

    let indexV1Sha: string | undefined;
    let manifestV2Sha: string | undefined;
    const shardV2Shas = new Map<string, string>();
    const records: GitHubRecordPath[] = [];
    for (const item of tree.tree) {
      if (item.type !== "blob" || !item.path || !item.sha) continue;
      if (item.path === SEARCH_INDEX_V1_PATH) {
        indexV1Sha = item.sha;
        continue;
      }
      if (item.path === SEARCH_INDEX_V2_MANIFEST_PATH) {
        manifestV2Sha = item.sha;
        continue;
      }
      if (item.path.startsWith(SEARCH_INDEX_V2_PREFIX) && item.path.endsWith(".json")) {
        shardV2Shas.set(item.path, item.sha);
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
      shardV2Shas,
      ...(indexV1Sha ? { indexV1Sha } : {}),
      ...(manifestV2Sha ? { manifestV2Sha } : {}),
    };
  }

  async #syncIndex(
    tree: SearchTreeSnapshot,
  ): Promise<{
    entries: Record<string, SearchIndexEntry>;
    refreshed: Map<string, StoredRecord>;
  }> {
    let previous: Record<string, SearchIndexEntry> = {};
    let currentV2 = false;

    if (tree.manifestV2Sha) {
      const manifest = await this.#loadManifestV2(tree.manifestV2Sha);
      if (manifest) {
        const loaded = await this.#loadShardsV2(manifest, tree.shardV2Shas);
        previous = loaded.entries;
        currentV2 = loaded.complete && manifestMatchesRecords(manifest, tree.records);
        if (currentV2) return { entries: previous, refreshed: new Map() };
      }
    } else if (tree.indexV1Sha) {
      const indexV1 = await this.#loadIndexV1(tree.indexV1Sha);
      previous = indexV1?.records ?? {};
    }

    const nextRecords: Record<string, SearchIndexEntry> = {};
    const changed: GitHubRecordPath[] = [];

    for (const record of tree.records) {
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

    const deletedCount = Object.keys(previous).length - (tree.records.length - changed.length);
    if (!currentV2 || changed.length > 0 || deletedCount > 0) {
      await this.#saveShardedIndex(buildShardedIndex(nextRecords));
    }
    return { entries: nextRecords, refreshed };
  }

  async #loadIndexV1(sha: string) {
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
      return validSearchIndexV1(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async #loadManifestV2(sha: string): Promise<SearchIndexManifestV2 | undefined> {
    try {
      const parsed = JSON.parse(await this.#loadTextBlob(sha)) as unknown;
      return validSearchIndexManifestV2(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async #loadShardsV2(
    manifest: SearchIndexManifestV2,
    available: Map<string, string>,
  ): Promise<{ entries: Record<string, SearchIndexEntry>; complete: boolean }> {
    const requested: GitHubRecordPath[] = [];
    let complete = true;
    for (const metadata of Object.values(manifest.shards)) {
      const sha = available.get(metadata.path);
      if (!sha) {
        complete = false;
        continue;
      }
      requested.push({ path: metadata.path, sha });
    }
    const texts = await this.#readTextBlobs(requested);
    const entries: Record<string, SearchIndexEntry> = {};
    for (const [key, metadata] of Object.entries(manifest.shards)) {
      const text = texts.get(metadata.path);
      if (!text) {
        complete = false;
        continue;
      }
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!validSearchIndexShardV2(parsed) || parsed.key !== key) {
          complete = false;
          continue;
        }
        const paths = Object.entries(parsed.records).map(([path, entry]) => ({ path, sha: entry.sha }));
        if (
          paths.length !== metadata.recordCount ||
          recordsDigest(paths) !== metadata.recordsDigest
        ) {
          complete = false;
          continue;
        }
        Object.assign(entries, parsed.records);
      } catch {
        complete = false;
      }
    }
    return { entries, complete };
  }

  async #loadTextBlob(sha: string): Promise<string> {
    const response = await this.#fetch(
      new URL(`repos/${this.#repositoryPath}/git/blobs/${encodeURIComponent(sha)}`, this.#apiBaseUrl),
      { method: "GET", headers: this.#headers() },
    );
    if (!response.ok) throw new Error("GitHub could not load search metadata.");
    const blob = (await response.json()) as GitHubBlob;
    if (blob.encoding !== "base64" || blob.sha !== sha) {
      throw new Error("GitHub returned unsupported search metadata.");
    }
    return Buffer.from(blob.content.replaceAll("\n", ""), "base64").toString("utf8");
  }

  async #saveShardedIndex(index: {
    manifest: SearchIndexManifestV2;
    shards: Map<string, SearchIndexShardV2>;
  }): Promise<void> {
    const commit = await this.#rest<GitHubCommitLookup>(
      `repos/${this.#repositoryPath}/commits/${encodeURIComponent(this.#branch)}`,
    );
    const additions = [
      ...[...index.shards.entries()].map(([key, shard]) => ({
        path: shardPath(key),
        contents: Buffer.from(JSON.stringify(shard), "utf8").toString("base64"),
      })),
      {
        path: SEARCH_INDEX_V2_MANIFEST_PATH,
        contents: Buffer.from(JSON.stringify(index.manifest), "utf8").toString("base64"),
      },
      {
        path: SEARCH_METADATA_README_PATH,
        contents: Buffer.from(SEARCH_METADATA_README, "utf8").toString("base64"),
      },
    ];
    const mutation = `mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`;
    const response = await this.#fetch(new URL("graphql", this.#apiBaseUrl), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            branch: {
              repositoryNameWithOwner: `${this.#owner}/${this.#name}`,
              branchName: this.#branch,
            },
            expectedHeadOid: commit.sha,
            message: { headline: "capture-reflect: update sharded search index" },
            fileChanges: { additions },
          },
        },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as GitHubGraphQlEnvelope<{
      createCommitOnBranch: { commit: { oid: string } } | null;
    }>;
    if (response.ok && !payload.errors?.length && payload.data?.createCommitOnBranch?.commit.oid) {
      return;
    }
    console.warn(
      "[capture-reflect][search-index]",
      JSON.stringify({
        event: "save_failed",
        status: response.status,
        message: payload.errors?.map((error) => error.message).join("; ") ?? payload.message ?? response.statusText,
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

  async #readTextBlobs(blobs: GitHubRecordPath[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const batches: GitHubRecordPath[][] = [];
    for (let offset = 0; offset < blobs.length; offset += GRAPHQL_BLOB_BATCH_SIZE) {
      batches.push(blobs.slice(offset, offset + GRAPHQL_BLOB_BATCH_SIZE));
    }
    for (let offset = 0; offset < batches.length; offset += GRAPHQL_BATCH_CONCURRENCY) {
      const wave = batches.slice(offset, offset + GRAPHQL_BATCH_CONCURRENCY);
      const waveResults = await Promise.all(wave.map((batch) => this.#readTextBatch(batch)));
      for (const batchResult of waveResults) {
        for (const [path, text] of batchResult) result.set(path, text);
      }
    }
    return result;
  }

  async #readTextBatch(batch: GitHubRecordPath[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (batch.length === 0) return result;
    const variableDefinitions = batch
      .map((_, index) => `$oid${index}: GitObjectID!`)
      .join(", ");
    const selections = batch
      .map((_, index) => `blob${index}: object(oid: $oid${index}) { ... on Blob { oid text } }`)
      .join("\n");
    const query = `query($owner: String!, $name: String!, ${variableDefinitions}) {
      repository(owner: $owner, name: $name) { ${selections} }
    }`;
    const variables: Record<string, string> = { owner: this.#owner, name: this.#name };
    for (const [index, blob] of batch.entries()) variables[`oid${index}`] = blob.sha;

    const response = await this.#fetch(new URL("graphql", this.#apiBaseUrl), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json().catch(() => ({}))) as GitHubGraphQlEnvelope<{
      repository: Record<string, GitHubGraphQlBlob | null> | null;
    }>;
    if (!response.ok || payload.errors?.length || !payload.data?.repository) {
      throw new Error("GitHub GraphQL could not load search index shards.");
    }
    for (const [index, blob] of batch.entries()) {
      const value = payload.data.repository[`blob${index}`];
      if (!value || value.text === null || value.oid !== blob.sha) continue;
      result.set(blob.path, value.text);
    }
    return result;
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

  async #rest<T>(apiPath: string): Promise<T> {
    const response = await this.#fetch(new URL(apiPath, this.#apiBaseUrl), {
      method: "GET",
      headers: this.#headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        `GitHub API GET failed (${response.status}): ${payload.message ?? response.statusText}`,
      );
    }
    return (await response.json()) as T;
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
