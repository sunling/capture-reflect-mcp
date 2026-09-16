import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp.js";
import type { RecordsStore } from "../src/storage/records-store.js";

function unusedStore(): RecordsStore {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected store operation.");
  };
  return {
    captureJournal: unused,
    captureNote: unused,
    saveReview: unused,
    getRecords: unused,
    searchRecords: unused,
  };
}

describe("capture routing metadata", () => {
  it("routes technical observations about journaling to notes", async () => {
    const server = createServer(unusedStore(), "UTC");
    const [client, transport] = InMemoryTransport.createLinkedPair();
    await server.connect(transport);
    await client.start();
    try {
      const result = new Promise<any>((resolve) => {
        client.onmessage = (message) => {
          if ("id" in message && message.id === 1 && "result" in message) resolve(message.result);
        };
      });
      await client.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      const listing = await result;
      const journal = listing.tools.find((tool: any) => tool.name === "capture_journal");
      const note = listing.tools.find((tool: any) => tool.name === "capture_note");
      expect(journal.description).toContain("Do not use this tool for technical observations");
      expect(note.description).toContain("记录日记时 durationMs 是 6685");
    } finally {
      await server.close();
      await client.close();
    }
  });
});
