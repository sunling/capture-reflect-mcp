import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { downloadImageAttachments } from "./attachments.js";
import { registerSkills } from "./skill-catalog.js";
import type { RecordsStore } from "./storage/records-store.js";

const recordTypeSchema = z.enum(["journal", "note"]);

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

export interface SetupLinkProvider {
  status(): Promise<{ connected: boolean; repository?: string; setupUrl: string }>;
}

export function createServer(
  store: RecordsStore,
  timeZone?: string,
  setup?: SetupLinkProvider,
): McpServer {
  const server = new McpServer(
    { name: "capture-reflect", version: "0.6.0" },
    {
      instructions:
        "Use capture_journal when the user asks to record their lived experience or feelings. Use capture_note for material they encountered, learned, quoted, collected, or want to remember, including ideas prompted by an external source. The interface and tool metadata are English-first, but records may use any language. Preserve the user's original language, script, wording, uncertainty, and code-switching; never translate a title or body unless the user explicitly asks. Respond in the language of the user's current request unless they request another language. For recall and review, keep quotations in their original language and clearly label any requested translation. Do not add conclusions the user did not express. When the user says today or gives no date, omit the date argument so the server applies its configured time zone. Only pass date when the user explicitly specifies a calendar date. Use read tools before reviews or questions about prior records. When the user asks to reconnect GitHub, reconfigure the connection, change the records repository, or update the time zone, call get_github_setup_link and give them its setupUrl; ChatGPT's own reconnect action does not replace this setup flow.",
    },
  );

  registerSkills(server);

  if (setup) {
    server.registerTool(
      "get_github_setup_link",
      {
        title: "Set up or update GitHub connection",
        description:
          "Get the secure setup link used to connect GitHub, change the records repository, or refresh the user's detected time zone. Use this for initial setup and whenever the user asks to reconnect, reconfigure, change repository, or update time zone.",
        inputSchema: z.object({}),
        outputSchema: z.object({
          connected: z.boolean(),
          repository: z.string().optional(),
          setupUrl: z.string().url(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async () => toolResult(await setup.status()),
    );
  }

  server.registerTool(
    "capture_journal",
    {
      title: "Record a journal entry",
      description:
        "Record a personal journal fragment in any language when the user asks to save an experience, event, feeling, observation, or daily reflection. Lightly edit for readability while preserving the user's original language, wording, code-switching, uncertainty, and unfinished thoughts. Never translate unless explicitly requested.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Omit when the user says today or gives no date; the server will use today in its configured time zone. Pass only for an explicitly specified calendar date.",
          ),
        title: z.string().min(1).describe("Short factual fragment heading in the user's original language"),
        keyword: z
          .string()
          .min(1)
          .max(40)
          .describe("Short filename keyword in the user's language when practical; Unicode letters and numbers, underscores, and hyphens are supported"),
        content: z.string().min(1).describe("Markdown journal body in the user's original language, without translation, invented summaries, or tags"),
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
        openWorldHint: true,
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
    "capture_note",
    {
      title: "Save a note",
      description:
        "Save a note in any language when the user asks to keep an article, book, podcast, video, course, conversation, quotation, link, something they learned, or an idea prompted by outside material. Preserve the source language and the user's response language, including code-switching; never translate unless explicitly requested. Keep the source and the user's own response distinguishable.",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe(
            "YYYY-MM-DD. Omit when the user says today or gives no date; the server will use today in its configured time zone. Pass only for an explicitly specified calendar date.",
          ),
        title: z.string().min(1).describe("Title in the user's original language"),
        keyword: z
          .string()
          .min(1)
          .max(40)
          .describe("Short filename keyword in the user's language when practical; Unicode letters and numbers, underscores, and hyphens are supported"),
        content: z
          .string()
          .min(1)
          .describe("Markdown note body preserving the source and user's original languages"),
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
        openWorldHint: true,
      },
    },
    async ({ date, title, keyword, content, tags, source, attachments }) => {
      const images = await downloadImageAttachments(attachments ?? []);
      return toolResult({
        ...(await store.captureNote({
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
        "Read journal entries and notes in any language within an inclusive date range. Use this before weekly or monthly reviews and whenever the user asks what they recorded during a period. Preserve source-language quotations; explain or summarize in the language of the user's request.",
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
        "Search journal entries and notes for words or phrases in any language. Use the user's original search terms when possible. Use this when the user asks whether, when, or how they previously mentioned a person, topic, feeling, event, or idea.",
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
