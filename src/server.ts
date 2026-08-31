#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createServer } from "./mcp.js";
import { createRecordsStore } from "./storage/create-records-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = createRecordsStore(config);
  const server = createServer(store, config.timeZone);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
