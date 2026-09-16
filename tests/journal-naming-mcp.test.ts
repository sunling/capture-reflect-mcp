import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { createServer } from "../src/mcp.js";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { recordId } from "../src/storage/record-graph.js";

it("captures without a journal keyword, appends without changing ID, and reuses legacy filenames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-journal-mcp-"));
  const server = createServer(new LocalRecordsStore(root), "UTC");
  const [client, transport] = InMemoryTransport.createLinkedPair();
  let requestId = 0;
  try {
    await server.connect(transport);
    await client.start();
    const capture = async (arguments_: { date: string; title: string; content: string }) => {
      const id = ++requestId;
      const response = new Promise<any>((resolve, reject) => {
        client.onmessage = (message) => {
          if ("id" in message && message.id === id) {
            if ("result" in message) resolve(message.result);
            else reject(new Error(JSON.stringify(message)));
          }
        };
      });
      await client.send({ jsonrpc: "2.0", id, method: "tools/call", params: {
        name: "capture_journal", arguments: arguments_,
      } });
      const result = await response;
      expect(result.isError).not.toBe(true);
      return result.structuredContent as { path: string; action: string };
    };

    const first = await capture({ date: "2026-09-16", title: "Morning", content: "Breakfast." });
    expect(first).toEqual({ path: "journals/2026/202609/20260916.md", action: "created", attachmentPaths: [] });
    const before = await fs.readFile(path.join(root, first.path), "utf8");
    const second = await capture({ date: "2026-09-16", title: "Evening", content: "Walked outside." });
    expect(second).toMatchObject({ path: first.path, action: "appended" });
    const after = await fs.readFile(path.join(root, first.path), "utf8");
    expect(after).toContain("### Morning\n\nBreakfast.");
    expect(after).toContain("### Evening\n\nWalked outside.");
    expect(recordId(after)).toBe(recordId(before));

    const old = "journals/2026/202609/20260915-周二-旧日记.md";
    await fs.writeFile(path.join(root, old), "Legacy entry.\n");
    const appended = await capture({ date: "2026-09-15", title: "Later", content: "Preserved." });
    expect(appended).toMatchObject({ path: old, action: "appended" });
    expect(await fs.readFile(path.join(root, old), "utf8")).toContain("Legacy entry.\n");
    await expect(fs.access(path.join(root, "journals/2026/202609/20260915.md"))).rejects.toThrow();
  } finally {
    await server.close();
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
