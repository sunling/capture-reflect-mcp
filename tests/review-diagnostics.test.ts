import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/mcp.js";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { createGitHubRequestTracker, withGitHubRequestObservability } from "../src/production/github-request-observability.js";

describe("Review failure diagnostics through MCP", () => {
  let root: string;
  let store: LocalRecordsStore;
  let currentPath: string;
  let historicalPath: string;
  const review = {
    date: "2026-09-15", from: "2026-09-08", to: "2026-09-14",
    title: "Weekly", keyword: "weekly", content: "Private review body: AI interpretation.",
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "review-diagnostics-"));
    store = new LocalRecordsStore(root);
    currentPath = (await store.captureNote({ date: "2026-09-10", title: "本周", keyword: "本周", content: "Private current evidence." })).path;
    historicalPath = (await store.captureNote({ date: "2026-09-07", title: "Earlier", keyword: "earlier", content: "Private earlier evidence." })).path;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(["mixed_ranges", "wrong_filename", "markdown_link", "changed_range", "renamed_record"])(
    "returns an actionable tool error and safe log for %s, then permits a corrected save",
    async (scenario) => {
      // Use paths actually returned by reads, including Unicode filenames.
      const current = await store.getRecords({ from: review.from, to: review.to });
      const previous = await store.getRecords({ from: "2026-09-01", to: "2026-09-07" });
      expect(current.map((record) => record.path)).toEqual([currentPath]);
      expect(previous.map((record) => record.path)).toEqual([historicalPath]);
      const inventedPath = "notes/2026/202609/20260910-wrong-title.md";
      let input = { ...review, sourcePaths: [currentPath, historicalPath, inventedPath] };
      let invalidPaths = [historicalPath, inventedPath];
      let code = "REVIEW_SOURCES_NOT_IN_RANGE";
      if (scenario === "wrong_filename") {
        input.sourcePaths = invalidPaths = [inventedPath];
      } else if (scenario === "markdown_link") {
        input.sourcePaths = invalidPaths = [`../../../${currentPath}`, `../../../${historicalPath}`];
        code = "REVIEW_SOURCE_PATH_INVALID";
      } else if (scenario === "changed_range") {
        input = { ...input, from: "2026-09-11", sourcePaths: [currentPath] };
        invalidPaths = [currentPath];
      } else if (scenario === "renamed_record") {
        input.sourcePaths = invalidPaths = [currentPath];
        const newPath = currentPath.replace("本周.md", "renamed.md");
        await fs.rename(path.join(root, currentPath), path.join(root, newPath));
        currentPath = newPath;
      }

      const observed = withGitHubRequestObservability(store, createGitHubRequestTracker());
      const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const server = createServer(observed, "UTC");
      const [client, transport] = InMemoryTransport.createLinkedPair();
      let nextId = 0;
      async function save(args: typeof input) {
        const id = ++nextId;
        const response = new Promise<any>((resolve, reject) => {
          client.onmessage = (message) => {
            if ("id" in message && message.id === id) {
              if ("result" in message) resolve(message.result);
              else reject(new Error(JSON.stringify(message)));
            }
          };
        });
        await client.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "save_review", arguments: args } });
        return response;
      }
      await server.connect(transport);
      await client.start();
      try {
        const failed = await save(input);
        expect(failed.isError).toBe(true);
        const errorText = failed.content[0].text;
        expect(errorText).toContain(code);
        for (const invalidPath of invalidPaths) expect(errorText).toContain(invalidPath);
        expect(errorText).toContain(`${input.from} to ${input.to}`);
        expect(errorText).toContain("Copy sourcePaths exactly");
        expect(await store.getRecords({ from: review.date, to: review.date, types: ["review"] })).toEqual([]);
        const payload = JSON.parse(log.mock.calls[0]![1] as string);
        expect(payload).toMatchObject({ operation: "save_review", outcome: "error", error: {
          code, stage: "review_source_validation", from: input.from, to: input.to,
          sourceCount: input.sourcePaths.length, invalidSourceCount: invalidPaths.length,
        } });
        const logged = JSON.stringify(log.mock.calls);
        for (const privateValue of [...input.sourcePaths, review.content, "Private current evidence."]) {
          expect(logged).not.toContain(privateValue);
        }

        const corrected = { ...review, sourcePaths: [currentPath] };
        const saved = await save(corrected);
        expect(saved.isError).not.toBe(true);
        expect(saved.structuredContent.action).toBe("created");
        const content = await fs.readFile(path.join(root, saved.structuredContent.path), "utf8");
        expect(content).toContain(review.content);
        expect(content).toContain(currentPath);
        expect((await save({ ...corrected, content: "replacement" })).isError).toBe(true);
        expect(await fs.readFile(path.join(root, saved.structuredContent.path), "utf8")).toBe(content);
      } finally {
        await server.close();
        await client.close();
      }
    },
  );

  it("does not mislabel a read failure as a source mismatch or log its sensitive message", async () => {
    const failure = new Error("Upstream failure with private details");
    vi.spyOn(store, "getRecords").mockRejectedValue(failure);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const observed = withGitHubRequestObservability(store, createGitHubRequestTracker());
    await expect(observed.saveReview({ ...review, sourcePaths: [currentPath] })).rejects.toBe(failure);
    expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({ outcome: "error", error: { code: "UNCLASSIFIED_ERROR" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
  });
});
