import { describe, expect, it, vi } from "vitest";
import { getBubbleBreakerContext } from "../src/bubble-breaker.js";
import type { RecordsStore } from "../src/storage/records-store.js";

function mockStore() {
  return {
    captureJournal: vi.fn(), captureNote: vi.fn(), searchRecords: vi.fn(),
    getRecords: vi.fn().mockResolvedValue([]),
  } satisfies RecordsStore;
}

describe("Bubble Breaker context", () => {
  it("uses the configured calendar date across year boundaries and reads both record types", async () => {
    const store = mockStore();
    const records = [{ path: "notes/2025/202512/20251231-input.md", date: "2025-12-31", type: "note", content: "Finished reading" }];
    store.getRecords.mockResolvedValue(records);
    const context = await getBubbleBreakerContext(store, {}, "America/Los_Angeles", new Date("2026-01-01T02:00:00Z"));
    expect(context).toMatchObject({ currentDate: "2025-12-31", from: "2025-12-25", to: "2025-12-31", records });
    expect(store.getRecords).toHaveBeenCalledWith({ from: "2025-12-25", to: "2025-12-31", types: ["journal", "note"] });
    expect(store.captureNote).not.toHaveBeenCalled();
    expect(store.captureJournal).not.toHaveBeenCalled();
  });

  it("counts calendar days across daylight saving and respects explicit ranges", async () => {
    const store = mockStore();
    const context = await getBubbleBreakerContext(store, {}, "America/Los_Angeles", new Date("2026-03-09T06:30:00Z"));
    expect(context).toMatchObject({ from: "2026-03-02", to: "2026-03-08", records: [] });
    await getBubbleBreakerContext(store, { from: "2024-02-29", to: "2024-03-01" });
    expect(store.getRecords).toHaveBeenLastCalledWith({ from: "2024-02-29", to: "2024-03-01", types: ["journal", "note"] });
  });

  it.each([
    { from: "2026-01-01" }, { to: "2026-01-01" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-03-02", to: "2026-03-01" },
    { from: "", to: "" },
  ])("rejects invalid or incomplete ranges before reading: %j", async (range) => {
    const store = mockStore();
    await expect(getBubbleBreakerContext(store, range)).rejects.toThrow();
    expect(store.getRecords).not.toHaveBeenCalled();
  });

  it("propagates storage failures instead of presenting an empty history", async () => {
    const store = mockStore();
    store.getRecords.mockRejectedValue(new Error("Repository unavailable"));
    await expect(getBubbleBreakerContext(store, {})).rejects.toThrow("Repository unavailable");
  });
});

describe("Bubble Breaker MCP integration", () => {
  it("exposes and executes the tool and publishes the skill resource", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/server");
    const { createServer } = await import("../src/mcp.js");
    const store = mockStore();
    const server = createServer(store, "Asia/Tokyo");
    const [client, transport] = InMemoryTransport.createLinkedPair();
    let requestId = 0;
    async function request(method: string, params: Record<string, unknown>) {
      const id = ++requestId;
      const response = new Promise<any>((resolve, reject) => {
        client.onmessage = (message) => {
          if ("id" in message && message.id === id) {
            if ("result" in message) resolve(message.result);
            else reject(new Error(JSON.stringify(message)));
          }
        };
      });
      await client.send({ jsonrpc: "2.0", id, method, params });
      return response;
    }
    await server.connect(transport);
    await client.start();
    try {
      const listing = await request("tools/list", {});
      expect(listing.tools.find((tool: any) => tool.name === "get_bubble_breaker_context").annotations.readOnlyHint).toBe(true);
      const result = await request("tools/call", {
        name: "get_bubble_breaker_context", arguments: { from: "2026-09-01", to: "2026-09-07" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ from: "2026-09-01", to: "2026-09-07", timeZone: "Asia/Tokyo", records: [] });
      expect(result.structuredContent.instructions).toContain("## discover");
      const resource = await request("resources/read", { uri: "skill://capture-reflect/bubble-breaker/SKILL.md" });
      expect(resource.contents[0].text).toBe(result.structuredContent.instructions);
      const invalid = await request("tools/call", { name: "get_bubble_breaker_context", arguments: { from: "2026-09-01" } });
      expect(invalid.isError).toBe(true);
      expect(store.getRecords).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
      await client.close();
    }
  });
});
