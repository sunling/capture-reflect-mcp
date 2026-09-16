import type { Config } from "@netlify/functions";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../../src/mcp.js";
import { authenticateRequest } from "../../src/production/auth.js";
import { loadProductionConfig } from "../../src/production/config.js";
import { ConnectionStore } from "../../src/production/connection-store.js";
import { createSetupUrl } from "../../src/production/setup-token.js";
import { connectionUserIdForSubject, lazyRecordsStore, recordsStoreForUser } from "../../src/production/user-store.js";

const runtime = loadProductionConfig();
const connections = new ConnectionStore(runtime);

const mcp = createMcpHandler(async ({ authInfo }) => {
  const subject = authInfo?.extra?.userId;
  if (typeof subject !== "string") throw new Error("Authenticated user is missing.");
  // Tokens issued before the subject/storage-key fix used github:<id>. Resolve
  // those signed legacy subjects so already-connected clients keep working.
  const userId = await connectionUserIdForSubject(connections, subject);
  const connection = await connections.get(userId);
  const store = lazyRecordsStore(async () => (
    await recordsStoreForUser(runtime, connections, userId, connection)
  ).store);
  return createServer(store, connection?.timeZone, {
    status: async () => ({
      connected: Boolean(connection?.repository && connection.installationId),
      ...(connection?.githubLogin ? { githubLogin: connection.githubLogin } : {}),
      ...(connection?.repository ? { repository: connection.repository } : {}),
      setupUrl: await createSetupUrl(runtime, userId),
    }),
  });
}, { legacy: "stateless", onerror: (error) => console.error(error) });

export default async (request: Request): Promise<Response> => {
  const startedAt = performance.now();
  let status = 500;
  try {
    if (request.method === "OPTIONS") {
      const response = new Response(null, {
        status: 204,
        headers: { allow: "POST, GET, DELETE, OPTIONS" },
      });
      status = response.status;
      return response;
    }
    const auth = await authenticateRequest(request, runtime);
    if (auth instanceof Response) {
      status = auth.status;
      return auth;
    }
    const response = await mcp.fetch(request, { authInfo: auth.authInfo });
    status = response.status;
    return response;
  } finally {
    console.info(
      "[capture-reflect][mcp-request]",
      JSON.stringify({
        outcome: status < 400 ? "success" : "error",
        status,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  }
};

export const config: Config = { path: "/mcp" };
