#!/usr/bin/env node

import { createServer as createNodeServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { loadHttpConfig } from "./config.js";
import { createServer } from "./mcp.js";
import { createRecordsStore } from "./storage/create-records-store.js";

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`);
}

async function readBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const body = await readBody(request);
  return new Request(requestUrl(request), {
    method: request.method ?? "GET",
    headers,
    ...(body ? { body: Buffer.from(body).toString("utf8") } : {}),
  });
}

async function sendWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

function sendJson(target: ServerResponse, status: number, value: unknown): void {
  target.statusCode = status;
  target.setHeader("content-type", "application/json; charset=utf-8");
  target.end(JSON.stringify(value));
}

function reportMcpError(error: Error): void {
  // Health checks and accidental POSTs may reach the MCP route without a JSON
  // content type. The handler still returns 415; avoid presenting that expected
  // client error as a server failure in the console.
  if (error.message === "Unsupported Media Type: Content-Type must be application/json") {
    return;
  }
  console.error(error);
}

export async function main(): Promise<void> {
  const config = loadHttpConfig();
  const store = createRecordsStore(config);
  const mcp = createMcpHandler(() => createServer(store, config.timeZone), {
    legacy: "stateless",
    onerror: reportMcpError,
  });

  const http = createNodeServer(async (request, response) => {
    try {
      const url = requestUrl(request);

      if (url.pathname === "/health" && request.method === "GET") {
        sendJson(response, 200, {
          status: "ok",
          server: "log-reflect-mcp",
          transport: "streamable-http",
        });
        return;
      }

      if (url.pathname !== "/mcp") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      await sendWebResponse(await mcp.fetch(await toWebRequest(request)), response);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Internal server error" });
      } else {
        response.end();
      }
    }
  });

  const shutdown = (): void => {
    http.close(() => {
      void mcp.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  http.listen(config.port, config.host, () => {
    console.error(
      `log-reflect-mcp listening on http://${config.host}:${config.port}/mcp`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
