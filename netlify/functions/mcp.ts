import type { Config } from "@netlify/functions";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../../src/mcp.js";
import { authenticateRequest } from "../../src/production/auth.js";
import { loadProductionConfig } from "../../src/production/config.js";
import { ConnectionStore } from "../../src/production/connection-store.js";
import { createSetupUrl } from "../../src/production/setup-token.js";
import { UnconfiguredRecordsStore } from "../../src/production/unconfigured-store.js";
import { recordsStoreForUser } from "../../src/production/user-store.js";

const runtime = loadProductionConfig();
const connections = new ConnectionStore(runtime);

const mcp = createMcpHandler(async ({ authInfo }) => {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "string") throw new Error("Authenticated user is missing.");
  const connection = await connections.get(userId);
  let store = new UnconfiguredRecordsStore();
  if (connection?.repository && connection.installationId) {
    store = (await recordsStoreForUser(runtime, connections, userId)).store;
  }
  return createServer(store, connection?.timeZone, {
    status: async () => ({
      connected: Boolean(connection?.repository && connection.installationId),
      ...(connection?.repository ? { repository: connection.repository } : {}),
      setupUrl: await createSetupUrl(runtime, userId),
    }),
  });
}, { legacy: "stateless", onerror: (error) => console.error(error) });

export default async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "POST, GET, DELETE, OPTIONS" } });
  }
  const auth = await authenticateRequest(request, runtime);
  if (auth instanceof Response) return auth;
  return mcp.fetch(request, { authInfo: auth.authInfo });
};

export const config: Config = { path: "/mcp" };
