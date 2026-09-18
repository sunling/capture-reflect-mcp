import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { applyRecordEdit, assertRecordPath, withRecordEditing } from "../src/storage/record-editing.js";
import { GitHubRecordsStore } from "../src/storage/github-records.js";
import { buildBloom, buildShardedIndex, gitBlobSha, SEARCH_INDEX_MANIFEST_PATH, shardPath, shardKeyForPath } from "../src/storage/search-index.js";

const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const notePath = "notes/2026/202609/20260916-沉香.md";
const journalPath = "journals/2026/202609/20260916-周三-散步.md";
const targets = [
  { kind: "note", recordPath: notePath },
  { kind: "journal", recordPath: journalPath },
] as const;

describe("unified journal and note editing", () => {
  it.each(["../notes/2026/202609/20260916-沉香.md", "reviews/2026/202609/20260916-回看.md", "journals/2026/202608/20260916-散步.md", "notes/2026/202609/20260931-沉香.md", "journals/2026/202609/images/photo.md", "notes/2026/202609/20260916-..\\escape.md"])(
    "rejects unsafe or non-record paths: %s", (value) => expect(() => assertRecordPath(value)).toThrow(),
  );
  it.each(targets)("accepts a canonical $kind path", ({ recordPath }) => {
    expect(() => assertRecordPath(recordPath)).not.toThrow();
  });

  it.each(targets)("appends to a $kind once without changing existing content", ({ recordPath }) => {
    const original = "---\ntitle: example\n---\n\n### 第一段\n\n第一次记录。\n";
    const change = { path: recordPath, mode: "append" as const, content: "### 补充\n\n后来查到的信息。" };
    const updated = applyRecordEdit(original, change);
    expect(updated).toBe(`${original}\n### 补充\n\n后来查到的信息。\n`);
    expect(() => applyRecordEdit(updated, change)).toThrow("already present");
  });

  it.each(targets)("replaces one unique passage in a $kind without touching other sections", ({ recordPath }) => {
    const original = "### 第一段\n早晨散步。\n\n### 第二段\n另一个发现。\n";
    const updated = applyRecordEdit(original, { path: recordPath, mode: "replace", oldText: "早晨散步。", content: "清晨散步。" });
    expect(updated).toBe(original.replace("早晨散步。", "清晨散步。"));
    expect(() => applyRecordEdit(original, { path: recordPath, mode: "replace", oldText: "不存在", content: "改" })).toThrow("no longer present");
    expect(() => applyRecordEdit("重复重复", { path: recordPath, mode: "replace", oldText: "重复", content: "改" })).toThrow("more than once");
    expect(() => applyRecordEdit(original, { path: recordPath, mode: "replace", content: "改" })).toThrow("requires exact oldText");
    expect(() => applyRecordEdit(original, { path: recordPath, mode: "append", content: "补充", oldText: "早晨散步。" })).toThrow("only valid");
  });

  it.each(["note", "journal"] as const)("updates a local $kind in place and search sees the changed content", async (kind) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "capture-reflect-record-edit-"));
    tempDirectories.push(root);
    const store = withRecordEditing(new LocalRecordsStore(root), { kind: "local", root });
    const created = kind === "note"
      ? await store.captureNote({ date: "2026-09-16", title: "沉香", keyword: "沉香", originalNote: "第一次记录。" })
      : await store.captureJournal({ date: "2026-09-16", title: "早晨", keyword: "散步", content: "第一次记录。" });
    const appended = await store.updateRecord!({ path: created.path, mode: "append", content: "### 补充\n\n木炭的故事。" });
    expect(appended).toEqual({ path: created.path, action: "appended" });
    const edited = await store.updateRecord!({ path: created.path, mode: "replace", oldText: "木炭的故事。", content: "沉香与木炭的故事。" });
    expect(edited.action).toBe("updated");
    const content = await fs.readFile(path.join(root, created.path), "utf8");
    expect(content).toContain("第一次记录。");
    expect(content).toContain("沉香与木炭的故事。");
    expect(content).not.toContain("\n木炭的故事。\n");
    const matches = await store.searchRecords({ query: "沉香与木炭", types: [kind] });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe(created.path);
    expect(await fs.readdir(path.join(root, kind === "note" ? "notes/2026/202609" : "journals/2026/202609"))).toHaveLength(1);
  });
});

function shaFor(text: string): string {
  return createHash("sha1").update(Buffer.from(`blob ${Buffer.byteLength(text)}\0`)).update(text).digest("hex");
}

class FakeGitHub {
  files = new Map<string, string>();
  head = "head-1";
  commitCount = 0;
  lastPaths: string[] = [];
  fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const answer = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && url.pathname === "/repos/sunling/records/commits/main") return answer({ sha: this.head, commit: { tree: { sha: "tree-1" } } });
    if (method === "GET" && url.pathname === "/repos/sunling/records/git/trees/tree-1") {
      return answer({ truncated: false, tree: [...this.files].map(([filePath, content]) => ({ path: filePath, type: "blob", sha: shaFor(content) })) });
    }
    if (method === "GET" && url.pathname.includes("/git/blobs/")) {
      const sha = url.pathname.split("/").at(-1);
      const value = [...this.files.values()].find((content) => shaFor(content) === sha);
      return value === undefined ? answer({ message: "Not found" }, 404) : answer({ sha, encoding: "base64", content: Buffer.from(value).toString("base64") });
    }
    if (method === "POST" && url.pathname === "/graphql") {
      const body = JSON.parse(init!.body as string) as { variables: { input: { expectedHeadOid: string; fileChanges: { additions: Array<{ path: string; contents: string }> } } } };
      if (body.variables.input.expectedHeadOid !== this.head) return answer({ errors: [{ message: "expected head oid does not match" }] });
      this.lastPaths = body.variables.input.fileChanges.additions.map((addition) => addition.path);
      for (const addition of body.variables.input.fileChanges.additions) this.files.set(addition.path, Buffer.from(addition.contents, "base64").toString("utf8"));
      this.head = `head-${++this.commitCount + 1}`;
      return answer({ data: { createCommitOnBranch: { commit: { oid: this.head } } } });
    }
    return answer({ message: "Not found" }, 404);
  };
}

describe("atomic GitHub record updates", () => {
  it.each(targets)("updates a $kind and its existing search index in one commit", async ({ recordPath }) => {
    const github = new FakeGitHub();
    const original = "---\ntitle: example\n---\n\n### 第一段\n第一次记录。\n";
    github.files.set(recordPath, original);
    const built = buildShardedIndex({ [recordPath]: { sha: gitBlobSha(original), bloom: buildBloom(original) } });
    github.files.set(SEARCH_INDEX_MANIFEST_PATH, JSON.stringify(built.manifest));
    const key = shardKeyForPath(recordPath);
    const indexPath = shardPath(key);
    github.files.set(indexPath, JSON.stringify(built.shards.get(key)));
    const store = withRecordEditing(new GitHubRecordsStore({ repository: "sunling/records", token: "test-token", fetch: github.fetch }), {
      kind: "github", repository: "sunling/records", token: "test-token", fetch: github.fetch,
    });
    const result = await store.updateRecord!({ path: recordPath, mode: "append", content: "### 补充\n更多知识。" });
    expect(result).toMatchObject({ action: "appended", path: recordPath });
    expect(result.recordUrl).toContain(recordPath.split("/").slice(0, 3).join("/"));
    expect(github.commitCount).toBe(1);
    expect(github.lastPaths).toEqual([recordPath, indexPath, SEARCH_INDEX_MANIFEST_PATH]);
    const current = github.files.get(recordPath)!;
    const shard = JSON.parse(github.files.get(indexPath)!) as { records: Record<string, { sha: string }> };
    expect(shard.records[recordPath]?.sha).toBe(gitBlobSha(current));
    expect(current).toContain("第一次记录。");
    expect(current).toContain("更多知识。");
  });
});
