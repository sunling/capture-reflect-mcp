import { describe, expect, it, vi } from "vitest";
import type { RecordsStore } from "../src/storage/records-store.js";
import {
  createGitHubRequestTracker,
  withGitHubRequestObservability,
} from "../src/production/github-request-observability.js";

function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4876",
      "x-ratelimit-used": "124",
      "x-ratelimit-reset": "1770000000",
      "x-ratelimit-resource": "core",
    },
  });
}

describe("GitHub request observability", () => {
  it("counts GitHub requests by endpoint category and keeps the latest rate-limit headers", async () => {
    const baseFetch: typeof globalThis.fetch = async () => rateLimitedResponse();
    const tracker = createGitHubRequestTracker(baseFetch);

    await tracker.fetch("https://api.github.com/repos/sunling/records/git/trees/main?recursive=1", {
      method: "GET",
    });
    await tracker.fetch("https://api.github.com/repos/sunling/records/contents/notes/2026/note.md", {
      method: "GET",
    });
    await tracker.fetch("https://api.github.com/repos/sunling/records/contents/notes/2026/note.md", {
      method: "PUT",
    });
    await tracker.fetch("https://api.github.com/graphql", {
      method: "POST",
    });

    expect(tracker.snapshot()).toMatchObject({
      total: 4,
      byCategory: {
        tree: 1,
        contents_read: 1,
        contents_write: 1,
        graphql_read: 1,
        other: 0,
      },
      rateLimit: {
        limit: 5000,
        remaining: 4876,
        used: 124,
        reset: 1770000000,
        resource: "core",
      },
    });
    expect(tracker.snapshot().durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs the request delta for one high-level records operation", async () => {
    const baseFetch: typeof globalThis.fetch = async () => rateLimitedResponse();
    const tracker = createGitHubRequestTracker(baseFetch);
    const store: RecordsStore = {
      captureJournal: async () => ({ path: "journals/test.md", action: "created", attachmentPaths: [] }),
      captureNote: async () => ({ path: "notes/test.md", action: "created", attachmentPaths: [] }),
      saveReview: async () => ({ path: "reviews/test.md", action: "created" }),
      getRecords: async () => [],
      searchRecords: async () => {
        await tracker.fetch("https://api.github.com/repos/sunling/records/git/trees/main?recursive=1", {
          method: "GET",
        });
        await tracker.fetch("https://api.github.com/graphql", {
          method: "POST",
        });
        return [];
      },
    };
    const observed = withGitHubRequestObservability(store, tracker);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await observed.searchRecords({ query: "focus" });
      expect(log).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(log.mock.calls[0]![1] as string) as Record<string, unknown>;
      expect(payload).toMatchObject({
        operation: "search_records",
        outcome: "success",
        requests: 2,
        byCategory: {
          tree: 1,
          contents_read: 0,
          contents_write: 0,
          graphql_read: 1,
          other: 0,
        },
        rateLimit: {
          limit: 5000,
          remaining: 4876,
          used: 124,
          resource: "core",
        },
      });
      expect(payload.durationMs).toEqual(expect.any(Number));
      expect(payload.githubMs).toEqual(expect.any(Number));
    } finally {
      log.mockRestore();
    }
  });
});
