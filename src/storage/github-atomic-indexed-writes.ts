import {
  assertDate,
  assertKeyword,
  attachmentMarkdown,
  buildJournalFragment,
  buildNoteDocument,
  compactDate,
  journalDirectory,
  journalFileName,
  journalHeading,
  noteDirectory,
} from "./record-utils.js";
import { prepareReview } from "./reviews.js";
import type {
  CaptureJournalInput,
  CaptureNoteInput,
  CaptureResult,
  RecordAttachment,
  RecordsStore,
  SaveReviewInput,
} from "./records-store.js";
import {
  BLOOM_BYTES,
  BLOOM_HASH_COUNT,
  SEARCH_INDEX_MANIFEST_PATH,
  SEARCH_INDEX_PREFIX,
  SEARCH_METADATA_README,
  SEARCH_METADATA_README_PATH,
  buildBloom,
  gitBlobSha,
  manifestMatchesRecords,
  recordsDigest,
  shardKeyForPath,
  shardPath,
  validSearchIndexManifest,
  validSearchIndexShard,
  type GitHubRecordPath,
  type SearchIndexManifest,
  type SearchIndexShard,
} from "./search-index.js";

interface AtomicIndexedWriteOptions {
  repository: string;
  token: string;
  branch?: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface GitHubCommitLookup {
  sha: string;
  commit: { tree: { sha: string } };
}

interface GitHubTree {
  truncated: boolean;
  tree: Array<{ path?: string; type?: string; sha?: string }>;
}

interface GitHubBlob {
  content: string;
  encoding: string;
  sha: string;
}

interface GitHubGraphQlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
  message?: string;
}

interface WriteSnapshot {
  headSha: string;
  records: GitHubRecordPath[];
  paths: Set<string>;
  manifestSha?: string;
  shardShas: Map<string, string>;
}

interface CommitAddition {
  path: string;
  contents: string;
}

const WRITE_RETRIES = 3;

class GitHubCommitConflictError extends Error {}

function repositoryParts(repository: string): { nameWithOwner: string; encoded: string } {
  const parts = repository.trim().split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("GitHub repository must use the owner/name format.");
  }
  return {
    nameWithOwner: `${parts[0]!}/${parts[1]!}`,
    encoded: parts.map(encodeURIComponent).join("/"),
  };
}

class AtomicIndexedWriter {
  readonly #store: RecordsStore;
  readonly #repository: string;
  readonly #repositoryPath: string;
  readonly #token: string;
  readonly #branch: string;
  readonly #apiBaseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(store: RecordsStore, options: AtomicIndexedWriteOptions) {
    const repository = repositoryParts(options.repository);
    if (!options.token.trim()) throw new Error("GitHub token must not be empty.");
    this.#store = store;
    this.#repository = repository.nameWithOwner;
    this.#repositoryPath = repository.encoded;
    this.#token = options.token.trim();
    this.#branch = options.branch?.trim() || "main";
    this.#apiBaseUrl = `${(options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "")}/`;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async captureNote(
    note: CaptureNoteInput,
  ): Promise<CaptureResult & { action: "created" }> {
    assertDate(note.date);
    assertKeyword(note.keyword);
    const filePath = `${noteDirectory(note.date)}/${compactDate(note.date)}-${note.keyword}.md`;

    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const snapshot = await this.#writeSnapshot();
      if (snapshot.paths.has(filePath)) throw new Error(`A note already exists at ${filePath}.`);

      const attachments = this.#prepareAttachments(
        snapshot.paths,
        "note",
        note.date,
        note.keyword,
        note.attachments ?? [],
      );
      const imageMarkdown = attachmentMarkdown(attachments.stored);
      const content = buildNoteDocument({
        ...note,
        content: imageMarkdown ? `${note.content.trim()}\n\n${imageMarkdown}` : note.content,
      });
      const additions = [...attachments.additions, this.#textAddition(filePath, content)];
      await this.#addAtomicIndexUpdate(snapshot, filePath, content, additions);

      try {
        await this.#commitAdditions(
          snapshot.headSha,
          additions,
          `capture-reflect: save note for ${note.date}`,
        );
        return {
          path: filePath,
          action: "created",
          attachmentPaths: attachments.stored.map((attachment) => attachment.path),
          recordUrl: this.#recordUrl(filePath),
        };
      } catch (error) {
        if (!(error instanceof GitHubCommitConflictError) || attempt === WRITE_RETRIES - 1) {
          throw error;
        }
      }
    }
    throw new Error("Could not save note after concurrent GitHub updates.");
  }

  async captureJournal(input: CaptureJournalInput): Promise<CaptureResult> {
    assertDate(input.date);
    assertKeyword(input.keyword);
    const directory = journalDirectory(input.date);
    const compact = compactDate(input.date);

    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const snapshot = await this.#writeSnapshot();
      const existing = snapshot.records.filter(
        ({ path }) =>
          path.startsWith(`${directory}/`) &&
          path.slice(directory.length + 1).startsWith(compact) &&
          path.endsWith(".md"),
      );
      if (existing.length > 1) {
        throw new Error(
          `Multiple journal files already exist for ${input.date}; choose one explicitly before writing.`,
        );
      }

      const attachments = this.#prepareAttachments(
        snapshot.paths,
        "journal",
        input.date,
        input.keyword,
        input.attachments ?? [],
      );
      const imageMarkdown = attachmentMarkdown(attachments.stored);
      const fragment = buildJournalFragment({
        ...input,
        content: imageMarkdown ? `${input.content.trim()}\n\n${imageMarkdown}` : input.content,
      });
      const existingRecord = existing[0];
      const filePath = existingRecord?.path ?? `${directory}/${journalFileName(input)}`;
      const content = existingRecord
        ? `${await this.#loadTextBlob(existingRecord.sha)}\n${fragment}`
        : `${journalHeading(input)}${fragment}`;
      const additions = [...attachments.additions, this.#textAddition(filePath, content)];
      await this.#addAtomicIndexUpdate(snapshot, filePath, content, additions);

      try {
        await this.#commitAdditions(
          snapshot.headSha,
          additions,
          existingRecord
            ? `capture-reflect: append journal entry for ${input.date}`
            : `capture-reflect: record journal entry for ${input.date}`,
        );
        return {
          path: filePath,
          action: existingRecord ? "appended" : "created",
          attachmentPaths: attachments.stored.map((attachment) => attachment.path),
          recordUrl: this.#recordUrl(filePath),
        };
      } catch (error) {
        if (!(error instanceof GitHubCommitConflictError) || attempt === WRITE_RETRIES - 1) {
          throw error;
        }
      }
    }
    throw new Error("Could not save journal after concurrent GitHub updates.");
  }

  async saveReview(input: SaveReviewInput): Promise<{ path: string; action: "created" }> {
    const review = await prepareReview(this.#store, input);
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const snapshot = await this.#writeSnapshot();
      if (snapshot.paths.has(review.path)) {
        throw new Error(`A review already exists at ${review.path}.`);
      }
      const additions = [this.#textAddition(review.path, review.content)];
      await this.#addAtomicIndexUpdate(snapshot, review.path, review.content, additions);
      try {
        await this.#commitAdditions(
          snapshot.headSha,
          additions,
          `capture-reflect: save review for ${input.from} to ${input.to}`,
        );
        return { path: review.path, action: "created" };
      } catch (error) {
        if (!(error instanceof GitHubCommitConflictError) || attempt === WRITE_RETRIES - 1) {
          throw error;
        }
      }
    }
    throw new Error("Could not save review after concurrent GitHub updates.");
  }

  async #writeSnapshot(): Promise<WriteSnapshot> {
    const commit = await this.#rest<GitHubCommitLookup>(
      `repos/${this.#repositoryPath}/commits/${encodeURIComponent(this.#branch)}`,
    );
    const tree = await this.#rest<GitHubTree>(
      `repos/${this.#repositoryPath}/git/trees/${encodeURIComponent(commit.commit.tree.sha)}?recursive=1`,
    );
    if (tree.truncated) {
      throw new Error("The GitHub repository tree is too large to update safely.");
    }

    const paths = new Set<string>();
    const records: GitHubRecordPath[] = [];
    const shardShas = new Map<string, string>();
    let manifestSha: string | undefined;
    for (const item of tree.tree) {
      if (item.type !== "blob" || !item.path || !item.sha) continue;
      paths.add(item.path);
      if (item.path === SEARCH_INDEX_MANIFEST_PATH) {
        manifestSha = item.sha;
      } else if (item.path.startsWith(SEARCH_INDEX_PREFIX) && item.path.endsWith(".json")) {
        shardShas.set(item.path, item.sha);
      } else if (
        item.path.endsWith(".md") &&
        (item.path.startsWith("journals/") ||
          item.path.startsWith("notes/") ||
          item.path.startsWith("reviews/"))
      ) {
        records.push({ path: item.path, sha: item.sha });
      }
    }
    return {
      headSha: commit.sha,
      records,
      paths,
      shardShas,
      ...(manifestSha ? { manifestSha } : {}),
    };
  }

  #prepareAttachments(
    existingPaths: Set<string>,
    type: "journal" | "note",
    date: string,
    keyword: string,
    attachments: RecordAttachment[],
  ): { stored: Array<{ path: string; alt: string }>; additions: CommitAddition[] } {
    const baseDirectory = type === "journal" ? journalDirectory(date) : noteDirectory(date);
    const imageDirectory = `${baseDirectory}/images`;
    const compact = compactDate(date);
    const reserved = new Set(existingPaths);
    const stored: Array<{ path: string; alt: string }> = [];
    const additions: CommitAddition[] = [];

    for (const [index, attachment] of attachments.entries()) {
      let suffix = index + 1;
      let filePath: string;
      while (true) {
        filePath = `${imageDirectory}/${compact}-${keyword}-${suffix}.${attachment.extension}`;
        if (!reserved.has(filePath)) break;
        suffix += 1;
      }
      reserved.add(filePath);
      stored.push({ path: filePath, alt: attachment.alt });
      additions.push({
        path: filePath,
        contents: Buffer.from(attachment.data).toString("base64"),
      });
    }
    return { stored, additions };
  }

  async #addAtomicIndexUpdate(
    snapshot: WriteSnapshot,
    recordPath: string,
    content: string,
    additions: CommitAddition[],
  ): Promise<void> {
    const entry = { sha: gitBlobSha(content), bloom: buildBloom(content) };
    if (snapshot.manifestSha) {
      const manifest = await this.#loadManifest(snapshot.manifestSha);
      if (!manifest || !manifestMatchesRecords(manifest, snapshot.records)) return;
      const key = shardKeyForPath(recordPath);
      const metadata = manifest.shards[key];
      const shardSha = metadata ? snapshot.shardShas.get(metadata.path) : undefined;
      let shard: SearchIndexShard;
      if (metadata) {
        if (!shardSha) return;
        const loaded = await this.#loadShard(shardSha, key);
        if (!loaded) return;
        const indexedRecords = Object.entries(loaded.records).map(([path, value]) => ({
          path,
          sha: value.sha,
        }));
        if (
          indexedRecords.length !== metadata.recordCount ||
          recordsDigest(indexedRecords) !== metadata.recordsDigest
        ) {
          return;
        }
        shard = loaded;
      } else {
        shard = this.#emptyShard(key);
      }

      const nextShard: SearchIndexShard = {
        ...shard,
        records: { ...shard.records, [recordPath]: entry },
      };
      const nextRecords = snapshot.records.filter(({ path }) => path !== recordPath);
      nextRecords.push({ path: recordPath, sha: entry.sha });
      const targetRecords = nextRecords.filter(({ path }) => shardKeyForPath(path) === key);
      const nextManifest: SearchIndexManifest = {
        ...manifest,
        shards: {
          ...manifest.shards,
          [key]: {
            path: shardPath(key),
            recordCount: targetRecords.length,
            recordsDigest: recordsDigest(targetRecords),
          },
        },
      };
      additions.push(
        this.#textAddition(shardPath(key), JSON.stringify(nextShard)),
        this.#textAddition(SEARCH_INDEX_MANIFEST_PATH, JSON.stringify(nextManifest)),
      );
      this.#addMetadataReadme(snapshot, additions);
      return;
    }

  }

  #addMetadataReadme(snapshot: WriteSnapshot, additions: CommitAddition[]): void {
    if (!snapshot.paths.has(SEARCH_METADATA_README_PATH)) {
      additions.push(this.#textAddition(SEARCH_METADATA_README_PATH, SEARCH_METADATA_README));
    }
  }

  #emptyShard(key: string): SearchIndexShard {
    return {
      bloomBytes: BLOOM_BYTES,
      hashCount: BLOOM_HASH_COUNT,
      key,
      records: {},
    };
  }

  async #loadManifest(sha: string): Promise<SearchIndexManifest | undefined> {
    try {
      const parsed = JSON.parse(await this.#loadTextBlob(sha)) as unknown;
      return validSearchIndexManifest(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async #loadShard(sha: string, key: string): Promise<SearchIndexShard | undefined> {
    try {
      const parsed = JSON.parse(await this.#loadTextBlob(sha)) as unknown;
      return validSearchIndexShard(parsed) && parsed.key === key ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async #loadTextBlob(sha: string): Promise<string> {
    const blob = await this.#rest<GitHubBlob>(
      `repos/${this.#repositoryPath}/git/blobs/${encodeURIComponent(sha)}`,
    );
    if (blob.encoding !== "base64" || blob.sha !== sha) {
      throw new Error(`GitHub returned an unsupported blob response for ${sha}.`);
    }
    return Buffer.from(blob.content.replaceAll("\n", ""), "base64").toString("utf8");
  }

  #textAddition(path: string, content: string): CommitAddition {
    return { path, contents: Buffer.from(content, "utf8").toString("base64") };
  }

  #recordUrl(path: string): string {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `https://github.com/${this.#repository}/blob/${encodeURIComponent(this.#branch)}/${encodedPath}`;
  }

  async #commitAdditions(
    expectedHeadOid: string,
    additions: CommitAddition[],
    message: string,
  ): Promise<void> {
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
              repositoryNameWithOwner: this.#repository,
              branchName: this.#branch,
            },
            expectedHeadOid,
            message: { headline: message },
            fileChanges: { additions },
          },
        },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as GitHubGraphQlEnvelope<{
      createCommitOnBranch: { commit: { oid: string } } | null;
    }>;
    if (!response.ok) {
      throw new Error(
        `GitHub GraphQL commit failed (${response.status}): ${payload.message ?? response.statusText}`,
      );
    }
    if (payload.errors?.length) {
      const errorText = payload.errors.map((error) => error.message ?? "Unknown error").join("; ");
      if (/expected.*head|head.*oid|does not match|out of date/i.test(errorText)) {
        throw new GitHubCommitConflictError(errorText);
      }
      throw new Error(`GitHub GraphQL commit failed: ${errorText}`);
    }
    if (!payload.data?.createCommitOnBranch?.commit.oid) {
      throw new Error("GitHub GraphQL commit returned no commit oid.");
    }
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

export function withAtomicIndexedGitHubWrites(
  store: RecordsStore,
  options: AtomicIndexedWriteOptions,
): RecordsStore {
  const writer = new AtomicIndexedWriter(store, options);
  return {
    captureJournal: (input) => writer.captureJournal(input),
    captureNote: (input) => writer.captureNote(input),
    saveReview: (input) => writer.saveReview(input),
    getRecords: (input) => store.getRecords(input),
    searchRecords: (input) => store.searchRecords(input),
  };
}
