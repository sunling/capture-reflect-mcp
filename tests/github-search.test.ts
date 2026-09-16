import { describe, expect, it } from "vitest";
import { withFastGitHubSearch } from "../src/storage/github-search.js";
import type { RecordsStore } from "../src/storage/records-store.js";

interface FakeRecordFile {
  path: string;
  sha: string;
  content: string;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeGitHubSearchApi {
  readonly files: FakeRecordFile[] = [];
  readonly metadata = new Map<string, FakeRecordFile>();
  treeRequests = 0;
  graphqlRequests = 0;
  indexReads = 0;
  indexWrites = 0;
  activeGraphql = 0;
  maxActiveGraphql = 0;
  headSha = "head-1";
  treeSha = "tree-1";
  #indexRevision = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && /\/repos\/sunling\/records\/commits\/main$/.test(url.pathname)) {
      return jsonResponse({ sha: this.headSha, commit: { tree: { sha: this.treeSha } } });
    }

    if (method === "GET" && url.pathname.includes("/git/trees/")) {
      this.treeRequests += 1;
      return jsonResponse({
        truncated: false,
        tree: [
          ...this.files.map((file) => ({ path: file.path, type: "blob", sha: file.sha })),
          ...[...this.metadata.values()].map((file) => ({ path: file.path, type: "blob", sha: file.sha })),
        ],
      });
    }

    if (method === "GET" && url.pathname.includes("/git/blobs/")) {
      this.indexReads += 1;
      const sha = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const metadata = [...this.metadata.values()].find((file) => file.sha === sha);
      if (metadata) {
        return jsonResponse({
          sha,
          encoding: "base64",
          content: Buffer.from(metadata.content, "utf8").toString("base64"),
        });
      }
      return jsonResponse({ message: "Not found" }, 404);
    }

    if (method === "POST" && url.pathname === "/graphql") {
      this.graphqlRequests += 1;
      this.activeGraphql += 1;
      this.maxActiveGraphql = Math.max(this.maxActiveGraphql, this.activeGraphql);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const body = JSON.parse(init?.body as string) as {
          query: string;
          variables: Record<string, unknown>;
        };
        if (body.query.includes("createCommitOnBranch")) {
          this.indexWrites += 1;
          const input = body.variables.input as {
            expectedHeadOid: string;
            fileChanges: { additions: Array<{ path: string; contents: string }> };
          };
          if (input.expectedHeadOid !== this.headSha) {
            return jsonResponse({ errors: [{ message: "expected head oid does not match" }] });
          }
          for (const addition of input.fileChanges.additions) {
            const content = Buffer.from(addition.contents, "base64").toString("utf8");
            this.metadata.set(addition.path, {
              path: addition.path,
              sha: `metadata-${++this.#indexRevision}`,
              content,
            });
          }
          this.headSha = `head-${this.#indexRevision}`;
          this.treeSha = `tree-${this.#indexRevision}`;
          return jsonResponse({
            data: { createCommitOnBranch: { commit: { oid: this.headSha } } },
          });
        }
        const repository: Record<string, { oid: string; text: string } | null> = {};
        for (const [key, oid] of Object.entries(body.variables)) {
          if (!key.startsWith("oid") || typeof oid !== "string") continue;
          const index = key.slice("oid".length);
          const file = [...this.files, ...this.metadata.values()]
            .find((candidate) => candidate.sha === oid);
          repository[`blob${index}`] = file ? { oid, text: file.content } : null;
        }
        return jsonResponse({ data: { repository } });
      } finally {
        this.activeGraphql -= 1;
      }
    }

    return jsonResponse({ message: "Not found" }, 404);
  };
}

function unusedStore(): RecordsStore {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected delegated operation.");
  };
  return {
    captureJournal: unused,
    captureNote: unused,
    saveReview: unused,
    getRecords: unused,
    searchRecords: unused,
  };
}

function addFiles(api: FakeGitHubSearchApi, count: number, contentForIndex: (index: number) => string): void {
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(4, "0");
    api.files.push({
      path: `notes/2026/202609/20260901-note-${suffix}.md`,
      sha: `sha-${index}`,
      content: contentForIndex(index),
    });
  }
}

function createStore(api: FakeGitHubSearchApi): RecordsStore {
  return withFastGitHubSearch(unusedStore(), {
    repository: "sunling/records",
    token: "test-token",
    fetch: api.fetch,
  });
}

describe("indexed GitHub search", () => {
  it("filters range-named reviews by metadata save date before applying the result limit", async () => {
    const api = new FakeGitHubSearchApi();
    const excluded = "reviews/2027/202701/20261201-20261207-earlier.md";
    const included = "reviews/2027/202701/20261225-20261231-计划被打乱之后.md";
    const legacy = "reviews/2027/202701/20270102-legacy.md";
    api.files.push(
      { path: excluded, sha: "excluded", content: "---\ndate: 2027-01-01\n---\nreview-marker" },
      { path: included, sha: "included", content: "---\ndate: 2027-01-02\n---\nreview-marker" },
      { path: legacy, sha: "legacy", content: "review-marker" },
    );
    const store = createStore(api);
    const options = { query: "review-marker", from: "2027-01-02", to: "2027-01-02", types: ["review" as const] };
    const limited = await store.searchRecords({ ...options, limit: 1 });
    expect(limited.map((record) => record.path)).toEqual([included]);
    expect(limited[0]?.date).toBe("2027-01-02");
    expect((await store.searchRecords(options)).map((record) => record.path)).toEqual([included, legacy]);
    expect(await store.searchRecords({ ...options, from: "2026-12-01", to: "2026-12-31" })).toEqual([]);
  });

  it("builds the index once, then narrows a warm search to candidate records", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 275, (index) => index === 274 ? "needle appears here" : `record ${index}`);
    const store = createStore(api);

    const first = await store.searchRecords({ query: "needle" });

    expect(first).toHaveLength(1);
    expect(first[0]?.path).toBe("notes/2026/202609/20260901-note-0274.md");
    expect(api.treeRequests).toBe(1);
    expect(api.graphqlRequests).toBe(4);
    expect(api.maxActiveGraphql).toBe(3);
    expect(api.indexWrites).toBe(1);
    expect(api.indexReads).toBe(0);
    expect(api.metadata.get(".capture-reflect/index/manifest.json")?.content)
      .not.toContain("needle appears here");

    const second = await store.searchRecords({ query: "needle" });

    expect(second).toEqual(first);
    expect(api.treeRequests).toBe(2);
    expect(api.indexReads).toBe(1);
    expect(api.indexWrites).toBe(1);
    expect(api.graphqlRequests).toBe(6);
  });

  it("self-heals only changed records by comparing blob SHAs", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 275, (index) => `record ${index}`);
    const store = createStore(api);

    await store.searchRecords({ query: "missing" });
    const graphqlAfterBuild = api.graphqlRequests;
    const writesAfterBuild = api.indexWrites;

    api.files[274] = {
      ...api.files[274]!,
      sha: "sha-274-updated",
      content: "a newly updated searchable phrase",
    };

    const matches = await store.searchRecords({ query: "updated searchable" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260901-note-0274.md");
    expect(api.graphqlRequests - graphqlAfterBuild).toBe(3);
    expect(api.indexWrites - writesAfterBuild).toBe(1);
    expect(api.indexReads).toBe(1);
  });

  it("falls back to exact scanning for queries shorter than one trigram", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 275, (index) => index === 274 ? "中文测试" : `record ${index}`);
    const store = createStore(api);

    await store.searchRecords({ query: "never-present" });
    const graphqlAfterBuild = api.graphqlRequests;

    const matches = await store.searchRecords({ query: "中文" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260901-note-0274.md");
    expect(api.graphqlRequests - graphqlAfterBuild).toBe(4);
  });
});
