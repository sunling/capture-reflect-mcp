import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp.js";
import { LocalRecordsStore } from "../src/storage/local-records.js";

async function session(run: (call: (name: string, args: Record<string, unknown>) => Promise<any>, root: string, store: LocalRecordsStore) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "note-lookup-"));
  const store = new LocalRecordsStore(root);
  const server = createServer(store, "UTC");
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  await client.start();
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const requestId = ++id;
    const response = new Promise<any>((resolve, reject) => {
      client.onmessage = (message) => {
        if ("id" in message && message.id === requestId) {
          if ("result" in message) resolve(message.result);
          else reject(new Error(JSON.stringify(message)));
        }
      };
    });
    await client.send({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } });
    return response;
  };
  try { await run(call, root, store); }
  finally {
    await server.close();
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

const note = { date: "2026-10-20", title: "转述与判断", keyword: "curation", originalNote: "转述也是在创作。\n保留原话。" };

describe("new note lookup outcome", () => {
  it("rejects silently omitted lookup and contradictory outcomes without creating a file", async () => {
    await session(async (call, _root, store) => {
      for (const extra of [
        {},
        { relatedLookup: { status: "linked", queries: ["转述"] } },
        { relatedLookup: { status: "no_meaningful_matches", queries: [], reason: "No matches" } },
        { relatedLookup: { status: "skipped", reason: "not asked to search" } },
      ]) {
        const result = await call("capture_note", { ...note, ...extra });
        expect(result.isError).toBe(true);
      }
      expect(await store.getRecords({ from: note.date, to: note.date })).toEqual([]);
    });
  });

  it("preserves original words and links a searched journal with a client-reported lookup trace", async () => {
    await session(async (call, root, store) => {
      await store.captureJournal({ date: "2026-10-17", title: "分享", keyword: "sharing", content: "转述能帮助我开始分享。" });
      const found = await call("search_records", { query: "转述", types: ["journal", "note"], limit: 10 });
      const entry = found.structuredContent.records[0];
      const result = await call("capture_note", {
        ...note,
        relatedLookup: { status: "linked", queries: ["转述"] },
        relatedEntries: [{ type: entry.type, path: entry.path, date: entry.date, excerpt: "转述能帮助我开始分享。", possibleConnection: "两次记录可能都在谈降低分享的门槛。" }],
      });
      expect(result.isError).not.toBe(true);
      const body = await fs.readFile(path.join(root, result.structuredContent.path), "utf8");
      expect(body).toContain(note.originalNote);
      expect(body).toContain(`../../../${entry.path}`);
      expect(body).toContain('related_lookup: {"status":"linked","queries":["转述"],"reportedBy":"client"}');
    });
  });

  it.each([
    { status: "no_meaningful_matches", queries: ["转述"], reason: "No relevant entries returned" },
    { status: "failed", queries: ["转述"], reason: "Record search unavailable" },
    { status: "skipped", reason: "user_requested" },
    { status: "skipped", reason: "bubble_breaker_completion" },
  ])("saves the original when lookup reports $status", async (relatedLookup) => {
    await session(async (call, root) => {
      const result = await call("capture_note", { ...note, relatedLookup });
      expect(result.isError).not.toBe(true);
      const body = await fs.readFile(path.join(root, result.structuredContent.path), "utf8");
      expect(body).toContain(note.originalNote);
      expect(body).toContain(`related_lookup: ${JSON.stringify({ ...relatedLookup, reportedBy: "client" })}`);
      expect(body).not.toContain("## 相关记录");
    });
  });
});
