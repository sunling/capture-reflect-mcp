import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp.js";
import { LocalRecordsStore } from "../src/storage/local-records.js";

it("exposes read-only backlinks for files created without the MCP", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "portable-graph-mcp-"));
  const store = new LocalRecordsStore(root);
  const server = createServer(store, "UTC");
  const [client, transport] = InMemoryTransport.createLinkedPair();
  try {
    const note = await store.captureNote({ date: "2026-09-16", title: "行动", keyword: "行动", originalNote: "当时的想法。" });
    const legacyPath = "journals/2026/202609/20260916-手写.md";
    await fs.mkdir(path.join(root, path.dirname(legacyPath)), { recursive: true });
    await fs.writeFile(path.join(root, legacyPath), `[关联](../../../${note.path.split("/").map(encodeURIComponent).join("/")})\n`);
    await server.connect(transport);
    await client.start();
    const response = new Promise<any>((resolve, reject) => {
      client.onmessage = (message) => {
        if ("id" in message && message.id === 1) {
          if ("result" in message) resolve(message.result);
          else reject(new Error(JSON.stringify(message)));
        }
      };
    });
    await client.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: "get_record_connections", arguments: { path: note.path },
    } });
    const result = await response;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.backlinks).toMatchObject([{ path: legacyPath, label: "关联" }]);
    expect(result.structuredContent.outgoing).toEqual([]);
    expect(result.structuredContent.record.id).toMatch(/^cr_/);
  } finally {
    await server.close();
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
