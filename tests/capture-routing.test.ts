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
  it("routes technical observations to notes and exposes only unified editing", async () => {
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
      expect(journal.description).toContain("Automatically");
      expect(note.description).toContain("recording system");
      expect(note.inputSchema.required).toContain("originalNote");
      expect(note.inputSchema.properties).not.toHaveProperty("content");
      expect(note.inputSchema.properties.source.properties).toHaveProperty("url");
      expect(note.inputSchema.properties.relatedEntries.maxItems).toBe(3);
      expect(note.inputSchema.properties.possibleActions.maxItems).toBe(5);
      expect(update.description).toContain("journal or note");
      expect(update.inputSchema.properties.mode.enum).toEqual(["append", "replace"]);
      expect(listing.tools.some((tool: any) => tool.name === "update_note")).toBe(false);

      // The model sees these descriptions even when it does not fetch the bundled Skill.
      expect(journal.description).toContain("explicitly asks to journal");
      expect(journal.description).toContain("entry mentions books");
      expect(journal.description).toContain("ask them to share it before calling this tool");
      expect(note.description).toContain("Explicit journal or diary requests ALWAYS go to capture_journal");
      expect(note.description).toContain("ask whether to save as journal or note and wait before writing");
      expect(note.description).toContain("Do not save a request to start journaling");
    } finally {
      await server.close();
      await client.close();
    }
  });
});
