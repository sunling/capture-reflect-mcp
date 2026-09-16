import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { applyNoteEdit, assertNotePath, withNoteEditing } from "../src/storage/note-editing.js";
import { GitHubRecordsStore } from "../src/storage/github-records.js";
import { buildBloom, buildShardedIndex, gitBlobSha, SEARCH_INDEX_MANIFEST_PATH } from "../src/storage/search-index.js";

const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const notePath = "notes/2026/202609/20260916-沉香.md";

describe("note editing guardrails", () => {
  it.each(["../notes/2026/202609/20260916-沉香.md", "journals/2026/202609/20260916-日记.md", "notes/2026/202608/20260916-沉香.md", "notes/2026/202609/20260931-沉香.md", "notes/2026/202609/images/photo.md"])(
    "rejects unsafe/non-note paths: %s", (value) => expect(() => assertNotePath(value)).toThrow(),
  );

  it("appends once, preserves the original note, and rejects duplicate additions", () => {
    const original = "---\ntitle: \"沉香\"\n---\n\n## 原始笔记\n\n第一版。\n";
    const change = { path: notePath, mode: "append" as const, content: "## 补充资料\n\n后来查到的信息。" };
    const updated = applyNoteEdit(original, change);
    expect(updated).toBe(`${original}\n## 补充资料\n\n后来查到的信息。\n`);
    expect(() => applyNoteEdit(updated, change)).toThrow("already present");
  });

  it("only replaces an exact unique excerpt", () => {
    const original = "## 原始笔记\n早晨散步。\n\n## 补充\n另一个发现。\n";
    const updated = applyNoteEdit(original, { path: notePath, mode: "replace", oldText: "早晨散步。", content: "清晨散步。" });
    expect(updated).toBe(original.replace("早晨散步。", "清晨散步。"));
    expect(() => applyNoteEdit(original, { path: notePath, mode: "replace", oldText: "不存在", content: "改" })).toThrow("no longer present");
    expect(() => applyNoteEdit("重复重复", { path: notePath, mode: "replace", oldText: "重复", content: "改" })).toThrow("more than once");
    expect(() => applyNoteEdit(original, { path: notePath, mode: "replace", content: "改" })).toThrow("requires exact oldText");
  });

  it("updates a local note in place and makes its additions searchable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "capture-reflect-note-edit-"));
    tempDirectories.push(root);
    const store = withNoteEditing(new LocalRecordsStore(root), { kind: "local", root });
    const created = await store.captureNote({ date: "2026-09-16", title: "沉香", keyword: "沉香", content: "## 原始笔记\n\n第一次记录。" });
    const appended = await store.updateNote!({ path: created.path, mode: "append", content: "## 补充资料\n\n木炭的故事。" });
    expect(appended).toEqual({ path: created.path, action: "appended" });
    const updated = await store.updateNote!({ path: created.path, mode: "replace", oldText: "木炭的故事。", content: "沉香与木炭的故事。" });
    expect(updated.action).toBe("updated");
    const content = await fs.readFile(path.join(root, created.path), "utf8");
    expect(content).toContain("## 原始笔记\n\n第一次记录。");
    expect(content).toContain("沉香与木炭的故事。");
    expect(await store.searchRecords({ query: "沉香与木炭" })).toHaveLength(1);
    expect(await store.searchRecords({ query: "木炭的故事。" })).toHaveLength(0);
    expect(await fs.readdir(path.join(root, "notes/2026/202609"))).toEqual(["20260916-沉香.md"]);
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

describe("atomic GitHub note editing", () => {
  it("updates the note and its existing search shard/manifest in one commit", async () => {
    const github = new FakeGitHub();
    const original = "---\ntitle: \"沉香\"\n---\n\n## 原始笔记\n第一次记录。\n";
    github.files.set(notePath, original);
    const built = buildShardedIndex({ [notePath]: { sha: gitBlobSha(original), bloom: buildBloom(original) } });
    github.files.set(SEARCH_INDEX_MANIFEST_PATH, JSON.stringify(built.manifest));
    github.files.set(".capture-reflect/index/notes/2026.json", JSON.stringify(built.shards.get("notes/2026")));
    const store = withNoteEditing(new GitHubRecordsStore({ repository: "sunling/records", token: "test-token", fetch: github.fetch }), {
      kind: "github", repository: "sunling/records", token: "test-token", fetch: github.fetch,
    });
    const result = await store.updateNote!({ path: notePath, mode: "append", content: "## 补充资料\n更多知识。" });
    expect(result).toMatchObject({ action: "appended", path: notePath });
    expect(result.recordUrl).toContain("notes/2026/202609/");
    expect(github.commitCount).toBe(1);
    expect(github.lastPaths).toEqual([notePath, ".capture-reflect/index/notes/2026.json", SEARCH_INDEX_MANIFEST_PATH]);
    const current = github.files.get(notePath)!;
    const shard = JSON.parse(github.files.get(".capture-reflect/index/notes/2026.json")!) as { records: Record<string, { sha: string }> };
    expect(shard.records[notePath]?.sha).toBe(gitBlobSha(current));
    expect(current).toContain("## 原始笔记");
    expect(current).toContain("更多知识。");
  });
});
