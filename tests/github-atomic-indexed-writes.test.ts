import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubRecordsStore } from "../src/storage/github-records.js";
import { createGitHubRequestTracker, withGitHubRequestObservability } from "../src/production/github-request-observability.js";
import { withAtomicIndexedGitHubWrites } from "../src/storage/github-atomic-indexed-writes.js";
import { withFastGitHubSearch } from "../src/storage/github-search.js";
import type { RecordsStore } from "../src/storage/records-store.js";

interface FakeFile {
  path: string;
  sha: string;
  bytes: Buffer;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function gitBlobSha(bytes: Buffer): string {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

class FakeGitHubApi {
  readonly files = new Map<string, FakeFile>();
  headSha = "head-1";
  treeSha = "tree-1";
  commitMutations = 0;
  lastCommitPaths: string[] = [];
  graphqlReads = 0;

  addText(path: string, content: string): void {
    const bytes = Buffer.from(content, "utf8");
    this.files.set(path, { path, bytes, sha: gitBlobSha(bytes) });
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && /\/repos\/sunling\/records\/commits\/main$/.test(url.pathname)) {
      return jsonResponse({ sha: this.headSha, commit: { tree: { sha: this.treeSha } } });
    }

    if (method === "GET" && url.pathname.includes("/git/trees/")) {
      return jsonResponse({
        truncated: false,
        tree: [...this.files.values()].map((file) => ({
          path: file.path,
          type: "blob",
          sha: file.sha,
        })),
      });
    }

    if (method === "GET" && url.pathname.includes("/git/blobs/")) {
      const sha = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const file = [...this.files.values()].find((candidate) => candidate.sha === sha);
      if (!file) return jsonResponse({ message: "Not found" }, 404);
      return jsonResponse({
        sha,
        encoding: "base64",
        content: file.bytes.toString("base64"),
      });
    }

    if (method === "POST" && url.pathname === "/graphql") {
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (body.query.includes("createCommitOnBranch")) {
        this.commitMutations += 1;
        const input = body.variables.input as {
          expectedHeadOid: string;
          fileChanges: { additions: Array<{ path: string; contents: string }> };
        };
        if (input.expectedHeadOid !== this.headSha) {
          return jsonResponse({ errors: [{ message: "expected head oid does not match" }] });
        }
        this.lastCommitPaths = input.fileChanges.additions.map((addition) => addition.path);
        for (const addition of input.fileChanges.additions) {
          const bytes = Buffer.from(addition.contents, "base64");
          this.files.set(addition.path, {
            path: addition.path,
            bytes,
            sha: gitBlobSha(bytes),
          });
        }
        this.headSha = `head-commit-${this.commitMutations}`;
        this.treeSha = `tree-commit-${this.commitMutations}`;
        return jsonResponse({
          data: { createCommitOnBranch: { commit: { oid: this.headSha } } },
        });
      }

      this.graphqlReads += 1;
      const variables = body.variables as Record<string, string>;
      const repository: Record<string, { oid: string; text: string } | null> = {};
      for (const [key, oid] of Object.entries(variables)) {
        if (!key.startsWith("oid")) continue;
        const index = key.slice("oid".length);
        const file = [...this.files.values()].find((candidate) => candidate.sha === oid);
        repository[`blob${index}`] = file
          ? { oid, text: file.bytes.toString("utf8") }
          : null;
      }
      return jsonResponse({ data: { repository } });
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

function createStore(api: FakeGitHubApi): RecordsStore {
  const options = {
    repository: "sunling/records",
    token: "test-token",
    fetch: api.fetch,
  };
  const searched = withFastGitHubSearch(unusedStore(), options);
  return withAtomicIndexedGitHubWrites(searched, options);
}

describe("atomic indexed GitHub writes", () => {
  it("reproduces pre-write source failures through the production store composition", async () => {
    const api = new FakeGitHubApi();
    const current = "notes/2026/202609/20260910-current.md";
    const earlier = "notes/2026/202609/20260907-earlier.md";
    api.addText(current, "Current evidence");
    api.addText(earlier, "Earlier evidence");
    const tracker = createGitHubRequestTracker(api.fetch);
    const options = { repository: "sunling/records", token: "test-token", branch: "main", fetch: tracker.fetch };
    const store = withGitHubRequestObservability(
      withAtomicIndexedGitHubWrites(withFastGitHubSearch(new GitHubRecordsStore(options), options), options), tracker,
    );
    const input = { date: "2026-09-15", from: "2026-09-08", to: "2026-09-14", title: "Weekly", keyword: "weekly", content: "AI interpretation: limited evidence.", sourcePaths: [current, earlier] };
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await expect(store.saveReview(input)).rejects.toMatchObject({ code: "REVIEW_SOURCES_NOT_IN_RANGE", invalidPaths: [earlier] });
      expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({
        operation: "save_review", outcome: "error", requests: 2,
        byCategory: { tree: 1, graphql_read: 1, graphql_write: 0, contents_write: 0, other: 0 },
        error: { code: "REVIEW_SOURCES_NOT_IN_RANGE", invalidSourceCount: 1 },
      });
      expect(api.commitMutations).toBe(0);
      expect([...api.files.keys()]).toEqual([current, earlier]);
      const result = await store.saveReview({ ...input, sourcePaths: [current] });
      expect(api.commitMutations).toBe(1);
      expect(api.files.get(result.path)?.bytes.toString()).toContain(input.content);
      expect(JSON.parse(log.mock.calls[1]![1] as string)).toMatchObject({ outcome: "success" });
      await expect(store.saveReview({ ...input, sourcePaths: [current], content: "replacement" })).rejects.toThrow("already exists");
      expect(api.commitMutations).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it("leaves initial index creation to the first search", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);

    await store.captureNote({
      date: "2026-09-16",
      title: "New note",
      keyword: "new-note",
      content: "new content",
    });

    expect(api.commitMutations).toBe(1);
    expect(api.lastCommitPaths).toEqual(["notes/2026/202609/20260916-new-note.md"]);
  });

  it("commits note, attachment, and a fresh search index together", async () => {
    const api = new FakeGitHubApi();
    api.addText("notes/2026/202609/20260901-old.md", "old searchable content");
    const store = createStore(api);

    await store.searchRecords({ query: "old searchable" });
    expect(api.commitMutations).toBe(1);

    const result = await store.captureNote({
      date: "2026-09-14",
      title: "Atomic note",
      keyword: "atomic-note",
      content: "atomic testing phrase",
      attachments: [
        {
          data: new Uint8Array([1, 2, 3]),
          extension: "png",
          mimeType: "image/png",
          alt: "tiny image",
        },
      ],
    });

    expect(result.action).toBe("created");
    expect(result.recordUrl).toBe(
      "https://github.com/sunling/records/blob/main/notes/2026/202609/20260914-atomic-note.md",
    );
    expect(api.commitMutations).toBe(2);
    expect(api.lastCommitPaths).toEqual(
      expect.arrayContaining([
        "notes/2026/202609/20260914-atomic-note.md",
        "notes/2026/202609/images/20260914-atomic-note-1.png",
        ".capture-reflect/index/notes/2026.json",
        ".capture-reflect/index/manifest.json",
      ]),
    );
    expect(api.lastCommitPaths).not.toContain(".capture-reflect/README.md");
    const matches = await store.searchRecords({ query: "atomic testing" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260914-atomic-note.md");
  });
});
