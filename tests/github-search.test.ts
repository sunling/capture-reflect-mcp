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
  treeRequests = 0;
  graphqlRequests = 0;
  indexReads = 0;
  indexWrites = 0;
  activeGraphql = 0;
  maxActiveGraphql = 0;
  indexSha: string | undefined;
  indexContent: string | undefined;
  #indexRevision = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname.includes("/git/trees/")) {
      this.treeRequests += 1;
      return jsonResponse({
        truncated: false,
        tree: [
          ...this.files.map((file) => ({ path: file.path, type: "blob", sha: file.sha })),
          ...(this.indexSha
            ? [{ path: ".capture-reflect/search-index-v1.json", type: "blob", sha: this.indexSha }]
            : []),
        ],
      });
    }

    if (method === "GET" && url.pathname.includes("/git/blobs/")) {
      this.indexReads += 1;
      const sha = decodeURIComponent(url.pathname.split("/").at(-1)!);
      if (!this.indexSha || sha !== this.indexSha || this.indexContent === undefined) {
        return jsonResponse({ message: "Not found" }, 404);
      }
      return jsonResponse({
        sha: this.indexSha,
        encoding: "base64",
        content: Buffer.from(this.indexContent, "utf8").toString("base64"),
      });
    }

    if (
      method === "PUT" &&
      url.pathname.endsWith("/contents/.capture-reflect/search-index-v1.json")
    ) {
      this.indexWrites += 1;
      const body = JSON.parse(init?.body as string) as {
        content: string;
        sha?: string;
      };
      if (this.indexSha && body.sha !== this.indexSha) {
        return jsonResponse({ message: "SHA does not match" }, 409);
      }
      if (!this.indexSha && body.sha) {
        return jsonResponse({ message: "File is missing" }, 422);
      }
      this.indexContent = Buffer.from(body.content, "base64").toString("utf8");
      this.indexSha = `index-sha-${++this.#indexRevision}`;
      return jsonResponse({ content: { sha: this.indexSha } }, body.sha ? 200 : 201);
    }

    if (method === "POST" && url.pathname === "/graphql") {
      this.graphqlRequests += 1;
      this.activeGraphql += 1;
      this.maxActiveGraphql = Math.max(this.maxActiveGraphql, this.activeGraphql);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const body = JSON.parse(init?.body as string) as {
          variables: Record<string, string>;
        };
        const repository: Record<string, { oid: string; text: string } | null> = {};
        for (const [key, oid] of Object.entries(body.variables)) {
          if (!key.startsWith("oid")) continue;
          const index = key.slice("oid".length);
          const file = this.files.find((candidate) => candidate.sha === oid);
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
  it("builds the index once, then narrows a warm search to candidate records", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 275, (index) => index === 274 ? "needle appears here" : `record ${index}`);
    const store = createStore(api);

    const first = await store.searchRecords({ query: "needle" });

    expect(first).toHaveLength(1);
    expect(first[0]?.path).toBe("notes/2026/202609/20260901-note-0274.md");
    expect(api.treeRequests).toBe(1);
    expect(api.graphqlRequests).toBe(3);
    expect(api.maxActiveGraphql).toBe(3);
    expect(api.indexWrites).toBe(1);
    expect(api.indexReads).toBe(0);
    expect(api.indexContent).not.toContain("needle appears here");

    const second = await store.searchRecords({ query: "needle" });

    expect(second).toEqual(first);
    expect(api.treeRequests).toBe(2);
    expect(api.indexReads).toBe(1);
    expect(api.indexWrites).toBe(1);
    expect(api.graphqlRequests).toBe(4);
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
    expect(api.graphqlRequests - graphqlAfterBuild).toBe(1);
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
    expect(api.graphqlRequests - graphqlAfterBuild).toBe(3);
  });
});
