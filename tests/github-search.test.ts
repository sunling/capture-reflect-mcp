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
  activeGraphql = 0;
  maxActiveGraphql = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname.includes("/git/trees/")) {
      this.treeRequests += 1;
      return jsonResponse({
        truncated: false,
        tree: this.files.map((file) => ({ path: file.path, type: "blob", sha: file.sha })),
      });
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

describe("fast GitHub search", () => {
  it("reads 100-record batches concurrently while preserving search results", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 275, (index) => index === 274 ? "needle appears here" : `record ${index}`);
    const store = withFastGitHubSearch(unusedStore(), {
      repository: "sunling/records",
      token: "test-token",
      fetch: api.fetch,
    });

    const matches = await store.searchRecords({ query: "needle" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260901-note-0274.md");
    expect(api.treeRequests).toBe(1);
    expect(api.graphqlRequests).toBe(3);
    expect(api.maxActiveGraphql).toBe(3);
  });

  it("stops after the first concurrent wave once the requested limit is satisfied", async () => {
    const api = new FakeGitHubSearchApi();
    addFiles(api, 1_000, (index) => index === 0 ? "early match" : `record ${index}`);
    const store = withFastGitHubSearch(unusedStore(), {
      repository: "sunling/records",
      token: "test-token",
      fetch: api.fetch,
    });

    const matches = await store.searchRecords({ query: "early", limit: 1 });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260901-note-0000.md");
    expect(api.treeRequests).toBe(1);
    expect(api.graphqlRequests).toBe(6);
    expect(api.maxActiveGraphql).toBe(6);
  });
});
