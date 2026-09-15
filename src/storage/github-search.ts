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
    const candidates = (await this.#listRecordPaths())
      .filter(({ path }) => {
        const date = recordDateFromPath(path);
        return Boolean(
          date &&
          date >= from &&
          date <= to &&
          requested.has(recordTypeFromPath(path)),
        );
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    const batches: GitHubRecordPath[][] = [];
    for (let offset = 0; offset < candidates.length; offset += GRAPHQL_BLOB_BATCH_SIZE) {
      batches.push(candidates.slice(offset, offset + GRAPHQL_BLOB_BATCH_SIZE));
    }

    const matches: Array<StoredRecord & { excerpts: string[] }> = [];
    for (let offset = 0; offset < batches.length; offset += GRAPHQL_BATCH_CONCURRENCY) {
      const wave = batches.slice(offset, offset + GRAPHQL_BATCH_CONCURRENCY);
      const waveResults = await Promise.all(wave.map((batch) => this.#readBatch(batch)));

      for (const batchRecords of waveResults) {
        for (const record of batchRecords) {
          const excerpts = record.content
            .split("\n")
            .filter((line) => line.toLocaleLowerCase().includes(query))
            .slice(0, 3);
          if (excerpts.length === 0) continue;
          matches.push({ ...record, excerpts });
          if (matches.length >= limit) return matches;
        }
      }
    }

    return matches;
  }

  async #listRecordPaths(): Promise<GitHubRecordPath[]> {
    const response = await this.#fetch(
      new URL(
        `repos/${this.#repositoryPath}/git/trees/${encodeURIComponent(this.#branch)}?recursive=1`,
        this.#apiBaseUrl,
      ),
      {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.#token}`,
          "content-type": "application/json",
          "user-agent": "capture-reflect-mcp",
          "x-github-api-version": "2022-11-28",
        },
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
    return tree.tree
      .flatMap((item) =>
        item.type === "blob" && item.path && item.sha
          ? [{ path: item.path, sha: item.sha }]
          : [],
      )
      .filter(
        ({ path }) =>
          path.endsWith(".md") &&
          (path.startsWith("journals/") ||
            path.startsWith("notes/") ||
            path.startsWith("reviews/")),
      );
  }

  async #readBatch(batch: GitHubRecordPath[]): Promise<StoredRecord[]> {
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
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.#token}`,
        "content-type": "application/json",
        "user-agent": "capture-reflect-mcp",
      },
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
