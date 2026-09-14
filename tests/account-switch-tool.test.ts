import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/mcp.js";
import { lazyRecordsStore } from "../src/production/user-store.js";

describe("Account switch recovery", () => {
  it("lists tools and issues direct switch links even when GitHub credentials cannot refresh", async () => {
    const load = vi.fn().mockRejectedValue(new Error("GitHub authorization expired"));
    const status = vi.fn().mockResolvedValue({ connected: true, githubLogin: "old-user", repository: "old-user/records", setupUrl: "https://api.example.com/setup?token=signed-token" });
    const server = createServer(lazyRecordsStore(load), "UTC", { status });
    const [client, transport] = InMemoryTransport.createLinkedPair();
    let id = 0;
    async function request(method: string, params: Record<string, unknown>) {
      const requestId = ++id;
      const result = new Promise<any>((resolve, reject) => {
        client.onmessage = (message) => {
          if ("id" in message && message.id === requestId) {
            if ("result" in message) resolve(message.result);
            else reject(new Error(JSON.stringify(message)));
          }
        };
      });
      await client.send({ jsonrpc: "2.0", id: requestId, method, params });
      return result;
    }
    await server.connect(transport);
    await client.start();
    try {
      const listed = await request("tools/list", {});
      expect(listed.tools.some((tool: any) => tool.name === "get_github_account_switch_link")).toBe(true);
      const switched = await request("tools/call", { name: "get_github_account_switch_link", arguments: {} });
      expect(switched.isError).not.toBe(true);
      expect(switched.structuredContent.githubLogin).toBe("old-user");
      const url = new URL(switched.structuredContent.setupUrl);
      expect(url.pathname).toBe("/setup");
      expect(url.searchParams.get("token")).toBe("signed-token");
      expect(url.searchParams.get("reauthorize")).toBe("1");
      expect(load).not.toHaveBeenCalled();
      const failedRead = await request("tools/call", { name: "get_records_by_date_range", arguments: { from: "2026-09-01", to: "2026-09-07" } });
      expect(failedRead.isError).toBe(true);
      expect(load).toHaveBeenCalledOnce();
      const setup = await request("tools/call", { name: "get_github_setup_link", arguments: {} });
      expect(setup.isError).not.toBe(true);
      expect(setup.structuredContent.setupUrl).toBe("https://api.example.com/setup?token=signed-token");
    } finally {
      await server.close();
      await client.close();
    }
  });
});
