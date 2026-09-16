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
  it("routes technical observations to notes, uses date-only journals, and exposes only unified editing", async () => {
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
      const update = listing.tools.find((tool: any) => tool.name === "update_record");
      expect(journal.description).toContain("not technical debugging");
      expect(journal.description).toContain("YYYYMMDD.md");
      expect(journal.inputSchema.required).not.toContain("keyword");
      expect(journal.inputSchema.properties.keyword.description).toContain("Legacy optional");
      expect(note.description).toContain("recording system");
      expect(note.inputSchema.required).toContain("keyword");
      expect(update.description).toContain("journal or note");
      expect(update.inputSchema.properties.mode.enum).toEqual(["append", "replace"]);
      expect(listing.tools.some((tool: any) => tool.name === "update_note")).toBe(false);
    } finally {
      await server.close();
      await client.close();
    }
  });
});
