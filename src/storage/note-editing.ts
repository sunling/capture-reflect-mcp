import { promises as fs } from "node:fs";
import path from "node:path";
import { assertDate } from "./record-utils.js";
import {
  buildBloom,
  gitBlobSha,
  manifestMatchesRecords,
  recordsDigest,
  shardKeyForPath,
  shardPath,
  validSearchIndexManifest,
  validSearchIndexShard,
  SEARCH_INDEX_MANIFEST_PATH,
  type GitHubRecordPath,
  type SearchIndexManifest,
  type SearchIndexShard,
} from "./search-index.js";
import type { NoteEditInput, NoteEditResult, RecordsStore } from "./records-store.js";

type Options =
  | { kind: "local"; root: string }
  | { kind: "github"; repository: string; token: string; branch?: string; apiBaseUrl?: string; fetch?: typeof globalThis.fetch };

/** Do not accept arbitrary repository paths, URLs, or paths outside notes/. */
export function assertNotePath(notePath: string): void {
  const match = /^notes\/(\d{4})\/(\d{6})\/(\d{8})-([^/]+)\.md$/u.exec(notePath);
  if (!match || match[1] !== match[2]!.slice(0, 4) || match[2] !== match[3]!.slice(0, 6) ||
      match[4] === "." || match[4] === ".." || match[4]!.includes("\\") || match[4]!.includes("..")) {
    throw new Error("Provide an exact note path returned by search_records or get_records_by_date_range under notes/YYYY/YYYYMM/.");
  }
  const compact = match[3]!;
  assertDate(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`);
}

/** The supplied replacement must identify exactly one passage; never regenerate the whole document. */
export function applyNoteEdit(previous: string, input: NoteEditInput): string {
  if (!input.content.trim()) throw new Error("content must not be empty.");
  if (input.mode === "append") {
    if (input.oldText !== undefined) throw new Error("oldText is only valid for replace mode.");
    const addition = input.content.trim();
    if (previous.includes(addition)) throw new Error("This exact content is already present in the note; no duplicate was added.");
    return `${previous.trimEnd()}\n\n${addition}\n`;
  }
  if (input.mode !== "replace") throw new Error("mode must be append or replace.");
  if (!input.oldText) throw new Error("replace mode requires exact oldText copied from the existing note.");
  const at = previous.indexOf(input.oldText);
  if (at === -1) throw new Error("The original passage is no longer present. Re-read the note before editing.");
  if (previous.indexOf(input.oldText, at + input.oldText.length) !== -1) {
    throw new Error("The original passage appears more than once. Select a longer unique passage.");
  }
  const updated = previous.slice(0, at) + input.content + previous.slice(at + input.oldText.length);
  if (updated === previous) throw new Error("The requested edit does not change the note.");
  return updated;
}

function encodedFilePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function updateLocal(root: string, input: NoteEditInput): Promise<NoteEditResult> {
  const base = path.resolve(root, "notes");
  const target = path.resolve(root, input.path);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Invalid note path.");
  const original = await fs.readFile(target, "utf8");
  const updated = applyNoteEdit(original, input);
  // A temporary file and rename avoid a partially written Markdown document.
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, updated, { encoding: "utf8", flag: "wx" });
    // Refuse to overwrite another edit that arrived while this one was prepared.
    if (await fs.readFile(target, "utf8") !== original) {
      throw new Error("The note changed while editing. Re-read it and try again.");
    }
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { path: input.path, action: input.mode === "append" ? "appended" : "updated" };
}

interface GitTree {
  truncated: boolean;
  tree: Array<{ path?: string; type?: string; sha?: string }>;
}
interface GitCommit { sha: string; commit: { tree: { sha: string } } }
interface GitBlob { sha: string; encoding: string; content: string }

class CommitConflict extends Error {}

class GitHubNoteEditor {
  readonly #repository: string;
  readonly #encodedRepository: string;
  readonly #branch: string;
  readonly #apiBase: string;
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: Extract<Options, { kind: "github" }>) {
    const parts = options.repository.split("/");
    if (parts.length !== 2 || parts.some((part) => !part)) throw new Error("Invalid GitHub repository.");
    this.#repository = options.repository;
    this.#encodedRepository = parts.map(encodeURIComponent).join("/");
    this.#branch = options.branch || "main";
    this.#token = options.token;
    this.#apiBase = `${(options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "")}/`;
    this.#fetch = options.fetch ?? globalThis.fetch;
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

  async #get<T>(endpoint: string): Promise<T> {
    const response = await this.#fetch(new URL(endpoint, this.#apiBase), { method: "GET", headers: this.#headers() });
    if (!response.ok) throw new Error(`GitHub read failed (${response.status}).`);
    return await response.json() as T;
  }

  async #blob(sha: string): Promise<string> {
    const blob = await this.#get<GitBlob>(`repos/${this.#encodedRepository}/git/blobs/${encodeURIComponent(sha)}`);
    if (blob.sha !== sha || blob.encoding !== "base64") throw new Error("Unexpected GitHub blob response.");
    return Buffer.from(blob.content.replaceAll("\n", ""), "base64").toString("utf8");
  }

  #addition(filePath: string, text: string): { path: string; contents: string } {
    return { path: filePath, contents: Buffer.from(text, "utf8").toString("base64") };
  }

  async #indexAdditions(
    entries: Array<{ path?: string; type?: string; sha?: string }>,
    recordPath: string,
    updated: string,
  ): Promise<Array<{ path: string; contents: string }>> {
    const manifestSha = entries.find((entry) => entry.path === SEARCH_INDEX_MANIFEST_PATH && entry.type === "blob")?.sha;
    if (!manifestSha) return [];
    const records: GitHubRecordPath[] = entries.flatMap(({ path: entryPath, sha, type }) =>
      type === "blob" && entryPath?.endsWith(".md") && sha &&
      (entryPath.startsWith("notes/") || entryPath.startsWith("journals/") || entryPath.startsWith("reviews/"))
        ? [{ path: entryPath, sha }] : [],
    );
    let manifest: SearchIndexManifest;
    try {
      const decoded = JSON.parse(await this.#blob(manifestSha)) as unknown;
      if (!validSearchIndexManifest(decoded) || !manifestMatchesRecords(decoded, records)) return [];
      manifest = decoded;
    } catch { return []; }
    const key = shardKeyForPath(recordPath);
    const meta = manifest.shards[key];
    const shardSha = entries.find((entry) => entry.path === shardPath(key) && entry.type === "blob")?.sha;
    if (!meta || !shardSha) return [];
    let shard: SearchIndexShard;
    try {
      const decoded = JSON.parse(await this.#blob(shardSha)) as unknown;
      if (!validSearchIndexShard(decoded) || decoded.key !== key ||
          Object.keys(decoded.records).length !== meta.recordCount ||
          recordsDigest(Object.entries(decoded.records).map(([filePath, value]) => ({ path: filePath, sha: value.sha }))) !== meta.recordsDigest) return [];
      shard = decoded;
    } catch { return []; }

    const nextSha = gitBlobSha(updated);
    const nextShard = { ...shard, records: { ...shard.records, [recordPath]: { sha: nextSha, bloom: buildBloom(updated) } } };
    const changed = records.map((record) => record.path === recordPath ? { ...record, sha: nextSha } : record);
    const updatedManifest = {
      ...manifest,
      shards: {
        ...manifest.shards,
        [key]: {
          path: shardPath(key),
          recordCount: changed.filter((record) => shardKeyForPath(record.path) === key).length,
          recordsDigest: recordsDigest(changed.filter((record) => shardKeyForPath(record.path) === key)),
        },
      },
    };
    return [
      this.#addition(shardPath(key), JSON.stringify(nextShard)),
      this.#addition(SEARCH_INDEX_MANIFEST_PATH, JSON.stringify(updatedManifest)),
    ];
  }

  async edit(input: NoteEditInput): Promise<NoteEditResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const commit = await this.#get<GitCommit>(`repos/${this.#encodedRepository}/commits/${encodeURIComponent(this.#branch)}`);
      const tree = await this.#get<GitTree>(`repos/${this.#encodedRepository}/git/trees/${encodeURIComponent(commit.commit.tree.sha)}?recursive=1`);
      if (tree.truncated) throw new Error("GitHub tree is too large to edit safely.");
      const current = tree.tree.find((entry) => entry.path === input.path && entry.type === "blob");
      if (!current?.sha) throw new Error("Note does not exist at the supplied path. Search for its exact path first.");
      const previous = await this.#blob(current.sha);
      const updated = applyNoteEdit(previous, input);
      const additions = [this.#addition(input.path, updated), ...await this.#indexAdditions(tree.tree, input.path, updated)];
      const mutation = `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }`;
      const response = await this.#fetch(new URL("graphql", this.#apiBase), {
        method: "POST", headers: this.#headers(),
        body: JSON.stringify({ query: mutation, variables: { input: {
          branch: { repositoryNameWithOwner: this.#repository, branchName: this.#branch },
          expectedHeadOid: commit.sha,
          message: { headline: `capture-reflect: ${input.mode} existing note` },
          fileChanges: { additions },
        } } }),
      });
      const result = await response.json() as {
        data?: { createCommitOnBranch?: { commit?: { oid?: string } } };
        errors?: Array<{ message?: string }>;
        message?: string;
      };
      if (!response.ok) throw new Error(`GitHub note update failed (${response.status}): ${result.message ?? "request failed"}`);
      if (result.errors?.length) {
        const messages = result.errors.map((error) => error.message ?? "unknown").join("; ");
        if (/expected.*head|head.*oid|does not match|out of date/i.test(messages)) {
          if (attempt < 2) continue;
          throw new CommitConflict("The note changed concurrently. Re-read it before updating.");
        }
        throw new Error(`GitHub note update failed: ${messages}`);
      }
      if (!result.data?.createCommitOnBranch?.commit?.oid) throw new Error("GitHub did not confirm the note update.");
      return {
        path: input.path,
        action: input.mode === "append" ? "appended" : "updated",
        recordUrl: `https://github.com/${this.#repository}/blob/${encodeURIComponent(this.#branch)}/${encodedFilePath(input.path)}`,
      };
    }
    throw new CommitConflict("The note changed concurrently. Re-read it before updating.");
  }
}

export function withNoteEditing(store: RecordsStore, options: Options): RecordsStore {
  const editor = options.kind === "github" ? new GitHubNoteEditor(options) : undefined;
  let pending = Promise.resolve();
  const updateNote = async (input: NoteEditInput): Promise<NoteEditResult> => {
    assertNotePath(input.path);
    if (editor) return editor.edit(input);
    // Serialize edits within the local store instance to avoid clobbering simultaneous appends.
    const operation = pending.then(() => updateLocal((options as Extract<Options, { kind: "local" }>).root, input));
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return {
    captureJournal: (input) => store.captureJournal(input),
    captureNote: (input) => store.captureNote(input),
    updateNote,
    saveReview: (input) => store.saveReview(input),
    getRecords: (input) => store.getRecords(input),
    searchRecords: (input) => store.searchRecords(input),
  };
}
