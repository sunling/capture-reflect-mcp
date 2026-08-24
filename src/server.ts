#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadConfig } from "./config.js";
import { LocalRecordsStore } from "./storage/local-records.js";

const recordTypeSchema = z.enum(["journal", "input"]);

function currentDate(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date());
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createServer(store: LocalRecordsStore, timeZone?: string): McpServer {
  const server = new McpServer({ name: "log-reflect-mcp", version: "0.1.0" });

  server.registerTool(
    "capture_journal",
    {
      description:
        "Create or append a personal journal fragment. Supply lightly edited content that preserves the user's words and uncertainty.",
      inputSchema: z.object({
        date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
        title: z.string().min(1).describe("Short factual fragment heading"),
        keyword: z.string().min(1).max(40).describe("Filename keyword without spaces or slashes"),
        content: z.string().min(1).describe("Markdown journal body without summaries or tags"),
      }),
    },
    async ({ date, title, keyword, content }) =>
      textResult(
        await store.captureJournal({
          date: date ?? currentDate(timeZone),
          title,
          keyword,
          content,
        }),
      ),
  );

  server.registerTool(
    "capture_input",
    {
      description:
        "Save an external input such as an article, book, podcast, video, course, or conversation as a Markdown note.",
      inputSchema: z.object({
        date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
        title: z.string().min(1),
        keyword: z.string().min(1).max(40).describe("Filename keyword without spaces or slashes"),
        content: z.string().min(1).describe("Markdown note body"),
        tags: z.array(z.string().min(1)).max(3).optional(),
        source: z.string().min(1).optional(),
      }),
    },
    async ({ date, title, keyword, content, tags, source }) =>
      textResult(
        await store.captureInput({
          date: date ?? currentDate(timeZone),
          title,
          keyword,
          content,
          ...(tags ? { tags } : {}),
          ...(source ? { source } : {}),
        }),
      ),
  );

  server.registerTool(
    "get_records_by_date_range",
    {
      description: "Read journal and input records within an inclusive date range.",
      inputSchema: z.object({
        from: z.string().describe("Inclusive start date in YYYY-MM-DD"),
        to: z.string().describe("Inclusive end date in YYYY-MM-DD"),
        types: z.array(recordTypeSchema).optional(),
      }),
    },
    async ({ from, to, types }) =>
      textResult(await store.getRecords({ from, to, ...(types ? { types } : {}) })),
  );

  server.registerTool(
    "search_records",
    {
      description: "Search journal and input Markdown files for matching text.",
      inputSchema: z.object({
        query: z.string().min(1),
        from: z.string().optional(),
        to: z.string().optional(),
        types: z.array(recordTypeSchema).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ query, from, to, types, limit }) =>
      textResult(
        await store.searchRecords({
          query,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(types ? { types } : {}),
          ...(limit ? { limit } : {}),
        }),
      ),
  );

  return server;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new LocalRecordsStore(config.recordsRepoPath);
  const server = createServer(store, config.timeZone);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

