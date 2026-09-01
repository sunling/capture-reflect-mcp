import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { downloadImageAttachments } from "./attachments.js";
import type { RecordsStore } from "./storage/records-store.js";

const recordTypeSchema = z.enum(["journal", "input"]);

const captureResultSchema = z.object({
  path: z.string(),
  action: z.enum(["created", "appended"]),
  attachmentPaths: z.array(z.string()),
});

const fileParamSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
});

const storedRecordSchema = z.object({
  path: z.string(),
  date: z.string(),
  type: recordTypeSchema,
  content: z.string(),
});

const searchRecordSchema = storedRecordSchema.extend({
  excerpts: z.array(z.string()),
});

function currentDate(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date());
}

function toolResult<T extends Record<string, unknown>>(value: T) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createServer(store: RecordsStore, timeZone?: string): McpServer {
  const server = new McpServer(
    { name: "log-reflect-mcp", version: "0.4.0" },
    {
      instructions:
        "Use capture_journal when the user asks to record their lived experience or feelings. Use capture_input for external material or ideas. Preserve the user's voice and uncertainty; do not add conclusions they did not express. When the user says today or gives no date, omit the date argument so the server applies its configured time zone. Only pass date when the user explicitly specifies a calendar date. Use read tools before reviews or questions about prior records.",
    },
  );

  server.registerTool(
    "capture_journal",
    {
      title: "Record a journal entry",
      description:
        "Record a personal journal fragment when the user asks to save an experience, event, feeling, observation, or daily reflection. Lightly edit for readability while preserving the user's wording, uncertainty, and unfinished thoughts.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Omit when the user says today or gives no date; the server will use today in its configured time zone. Pass only for an explicitly specified calendar date.",
          ),
        title: z.string().min(1).describe("Short factual fragment heading"),
        keyword: z
          .string()
          .min(1)
          .max(40)
          .describe("Short filename keyword using letters, numbers, underscores, or hyphens"),
        content: z.string().min(1).describe("Markdown journal body without invented summaries or tags"),
        attachments: z
          .array(fileParamSchema)
          .max(5)
          .optional()
          .describe("Optional image files uploaded in ChatGPT"),
      }),
      outputSchema: captureResultSchema,
      _meta: { "openai/fileParams": ["attachments"] },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ date, title, keyword, content, attachments }) => {
      const images = await downloadImageAttachments(attachments ?? []);
      return toolResult({
        ...(await store.captureJournal({
          date: date ?? currentDate(timeZone),
          title,
          keyword,
          content,
          ...(images.length > 0 ? { attachments: images } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "capture_input",
    {
      title: "Record an input",
      description:
        "Record an external input when the user asks to save an article, book, podcast, video, course, conversation, quotation, link, or an idea prompted by outside material. Keep the source and the user's own response distinguishable.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Omit when the user says today or gives no date; the server will use today in its configured time zone. Pass only for an explicitly specified calendar date.",
          ),
        title: z.string().min(1),
        keyword: z
          .string()
          .min(1)
          .max(40)
          .describe("Short filename keyword using letters, numbers, underscores, or hyphens"),
        content: z.string().min(1).describe("Markdown note body"),
        tags: z.array(z.string().min(1)).max(3).optional(),
        source: z.string().min(1).optional().describe("Source title or URL when available"),
        attachments: z
          .array(fileParamSchema)
          .max(5)
          .optional()
          .describe("Optional image files uploaded in ChatGPT"),
      }),
      outputSchema: z.object({
        path: z.string(),
        action: z.literal("created"),
        attachmentPaths: z.array(z.string()),
      }),
      _meta: { "openai/fileParams": ["attachments"] },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ date, title, keyword, content, tags, source, attachments }) => {
      const images = await downloadImageAttachments(attachments ?? []);
      return toolResult({
        ...(await store.captureInput({
          date: date ?? currentDate(timeZone),
          title,
          keyword,
          content,
          ...(tags ? { tags } : {}),
          ...(source ? { source } : {}),
          ...(images.length > 0 ? { attachments: images } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "get_records_by_date_range",
    {
      title: "Read records by date range",
      description:
        "Read journal entries and input notes in an inclusive date range. Use this before weekly or monthly reviews and whenever the user asks what they recorded during a period.",
      inputSchema: z.object({
        from: z.string().describe("Inclusive start date in YYYY-MM-DD"),
        to: z.string().describe("Inclusive end date in YYYY-MM-DD"),
        types: z.array(recordTypeSchema).optional(),
      }),
      outputSchema: z.object({ records: z.array(storedRecordSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ from, to, types }) =>
      toolResult({
        records: await store.getRecords({ from, to, ...(types ? { types } : {}) }),
      }),
  );

  server.registerTool(
    "search_records",
    {
      title: "Search personal records",
      description:
        "Search journal entries and input notes for words or phrases. Use this when the user asks whether, when, or how they previously mentioned a person, topic, feeling, event, or idea.",
      inputSchema: z.object({
        query: z.string().min(1),
        from: z.string().optional().describe("Optional start date in YYYY-MM-DD"),
        to: z.string().optional().describe("Optional end date in YYYY-MM-DD"),
        types: z.array(recordTypeSchema).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: z.object({ records: z.array(searchRecordSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, from, to, types, limit }) =>
      toolResult({
        records: await store.searchRecords({
          query,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(types ? { types } : {}),
          ...(limit ? { limit } : {}),
        }),
      }),
  );

  return server;
}
