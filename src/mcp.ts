import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getBubbleBreakerContext } from "./bubble-breaker.js";
import { loadSkillCatalog, registerSkills } from "./skill-catalog.js";
import type { RecordsStore } from "./storage/records-store.js";

const recordTypeSchema = z.enum(["journal", "note", "review"]);

const captureResultSchema = z.object({
  path: z.string(),
  action: z.enum(["created", "appended"]),
  attachmentPaths: z.array(z.string()),
  recordUrl: z.string().url().optional(),
});

const fileParamSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().min(1),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
  alt: z.string().optional().describe("Image description in the user's language, based on supplied context or visible image content. Preserve a user-provided description; omit when unavailable."),
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
  status(): Promise<{ connected: boolean; githubLogin?: string; repository?: string; setupUrl: string }>;
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
        "Choose capture_journal or capture_note from the user's intended subject, not from a trigger word appearing in the text. Use capture_journal for lived experiences, events, feelings, observations about the user's day, or an explicit instruction to save the material as a journal. Use capture_note for encountered material, knowledge, quotations, technical observations, debugging findings, measurements, product tests, design decisions, and ideas the user wants to remember. A sentence such as '记录日记时 durationMs 是 6685' is a technical note about the recording system, not a journal request, unless the user explicitly says to save it as a journal. The interface and tool metadata are English-first, but records may use any language. Preserve the user's original language, script, wording, uncertainty, and code-switching; never translate a title or body unless the user explicitly asks. Respond in the language of the user's current request unless they request another language. For recall and review, keep quotations in their original language and clearly label any requested translation. Do not attribute conclusions to the user that they did not express. For note capture, keep the original note verbatim and place any AI-generated connections or reflections in separate, explicitly labeled sections as described by capture_note and the capture-record skill. When the user says today or gives no date, omit the date argument so the server applies its configured time zone. Only pass date when the user explicitly specifies a calendar date. After a successful capture, present recordUrl as a clickable Markdown link when it is returned. Use read tools before reviews or questions about prior records. Follow review-records and finish a requested review with save_review unless the user asks for chat-only output. Read earlier reviews only as interpretations to check against original records, not as independent evidence. When the user asks to switch GitHub accounts, call get_github_account_switch_link. For initial setup, repository changes, or time-zone updates, call get_github_setup_link and give them its setupUrl; the AI client's own reconnect action does not replace this setup flow.",
    },
  );

  registerSkills(server);

  const bubbleBreaker = loadSkillCatalog().find((skill) => skill.frontmatter.name === "bubble-breaker")!;
  server.registerTool(
    "get_bubble_breaker_context",
    {
      title: "Get Bubble Breaker context",
      description:
        "Get recent journals and notes plus the Bubble Breaker workflow for one unfamiliar resource, diverse perspectives, blind spots, cross-domain connections, Socratic questions, or recording a reported completion. Defaults to the last seven calendar days in the configured time zone. This read-only tool does not browse or generate recommendations; the client must verify external resources with web tools. Do not save recommendations as completed. For an explicit completion, follow the returned minimal capture_note workflow without automatic enrichment.",
      inputSchema: z.object({
        from: z.string().optional().describe("Inclusive YYYY-MM-DD start; provide with to, or omit both"),
        to: z.string().optional().describe("Inclusive YYYY-MM-DD end; provide with from, or omit both"),
      }),
      outputSchema: z.object({
        currentDate: z.string(),
        currentTimestamp: z.string(),
        timeZone: z.string(),
        from: z.string(),
        to: z.string(),
        records: z.array(storedRecordSchema),
        instructions: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (range) => toolResult({
      ...await getBubbleBreakerContext(store, range, timeZone),
      instructions: bubbleBreaker.content,
    }),
  );

  if (setup) {
    server.registerTool(
      "get_github_setup_link",
      {
        title: "Set up or update GitHub connection",
        description:
          "Get the secure setup link used to connect GitHub, switch GitHub accounts, change the records repository, or refresh the user's detected time zone. Use this for initial setup and whenever the user asks to reconnect, switch GitHub account, reconfigure, change repository, or update time zone. To switch accounts, open the link and choose Use a different GitHub account; disconnecting the plugin in the client does not clear the saved GitHub connection.",
        inputSchema: z.object({}),
        outputSchema: z.object({
          connected: z.boolean(),
          githubLogin: z.string().optional(),
          repository: z.string().optional(),
          setupUrl: z.string().url(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async () => toolResult(await setup.status()),
    );
    server.registerTool(
      "get_github_account_switch_link",
      {
        title: "Switch GitHub account",
        description: "Get a secure link that opens GitHub's account picker to change the account holding your records. Use when the user wants a different GitHub account or reconnect keeps using the old account. Give the returned setupUrl to the user. Opening it starts authorization; this tool alone changes nothing. After authorizing, the user must select a repository. Do not instruct the user to reinstall the plugin or use the ChatGPT OAuth callback URL.",
        inputSchema: z.object({}),
        outputSchema: z.object({
          connected: z.boolean(),
          githubLogin: z.string().optional(),
          repository: z.string().optional(),
          setupUrl: z.string().url(),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async () => {
        const status = await setup.status();
        const url = new URL(status.setupUrl);
        url.searchParams.set("reauthorize", "1");
        return toolResult({ ...status, setupUrl: url.toString() });
      },
    );
  }

  server.registerTool(
    "capture_journal",
    {
      title: "Record a journal entry",
      description:
        "Record a personal journal entry fragment in any language when the user asks to save a lived experience, event, feeling, observation about their day, or daily reflection, or explicitly asks to save the material as a journal. Classify by intended subject, not by the mere appearance of words such as journal or 日记. Do not use this tool for technical observations, debugging findings, measurements, product tests, design decisions, or ideas about the recording system; use capture_note for those. Lightly edit for readability while preserving the user's original language, wording, code-switching, uncertainty, and unfinished thoughts. Never translate unless explicitly requested.",
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
          .describe("Short filename keyword in the user's language when practical; Unicode letters, combining marks, and numbers, underscores, and hyphens are supported"),
        content: z.string().min(1).describe("Markdown journal entry body in the user's original language, without translation, invented summaries, or tags"),
        attachments: z
          .array(fileParamSchema)
          .max(5)
          .optional()
          .describe("Optional image files supplied by the AI client"),
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
      const images = attachments?.length
        ? await (await import("./attachments.js")).downloadImageAttachments(attachments)
        : [];
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
        "Save a note in any language when the user asks to keep an article, book, podcast, video, course, conversation, quotation, link, something they learned, a technical observation, debugging finding, measurement, product test, design decision, or idea. Use this tool when the subject is the recording system itself even if the text mentions journal or 日记; for example, '记录日记时 durationMs 是 6685' is a note about system performance. Follow the capture-record skill: preserve the original note verbatim under Original note, with optional Source, Related journal entries, and Further reflection sections, using headings in the note's language. Before saving, unless the user asks to skip enrichment, start with one focused search_records query using types: ['journal']; only make another focused search when the first result is clearly insufficient, with at most three searches total. Read returned content and include at most three meaningful connections with dates, relative file links, exact excerpts, and explanations labeled Possible connection (AI). Label further AI reflections explicitly and never attribute them to the user. Omit empty optional sections. If lookup fails, still save the original and disclose the lookup failure. Respect an explicitly requested format. This tool stores the supplied Markdown; it does not search or structure it automatically. After saving, present recordUrl as a clickable Markdown link when it is returned.",
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
          .describe("Short filename keyword in the user's language when practical; Unicode letters, combining marks, and numbers, underscores, and hyphens are supported"),
        content: z
          .string()
          .min(1)
          .describe("Markdown body with a required Original note section containing the user's original text verbatim; optional Source, Related journal entries (verified journal links and excerpts, with AI-labeled possible connections), and Further reflection (AI-labeled) sections. Use headings in the note's language and omit empty optional sections. Honor an explicitly requested format; keep rewrites separate from the original."),
        tags: z.array(z.string().min(1)).max(3).optional(),
        source: z.string().min(1).optional().describe("Source title or URL when available"),
        attachments: z
          .array(fileParamSchema)
          .max(5)
          .optional()
          .describe("Optional image files supplied by the AI client"),
      }),
      outputSchema: z.object({
        path: z.string(),
        action: z.literal("created"),
        attachmentPaths: z.array(z.string()),
        recordUrl: z.string().url().optional(),
      }),
      _meta: { "openai/fileParams": ["attachments"] },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ date, title, keyword, content, tags, source, attachments }) => {
      const images = attachments?.length
        ? await (await import("./attachments.js")).downloadImageAttachments(attachments)
        : [];
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
    "save_review",
    {
      title: "Save a review",
      description: "Save a completed review under reviews/ as the final step of the review-records workflow, unless the user asks not to save. Include source-grounded patterns, questions, unfinished threads, and clearly separated user thoughts and AI interpretations. Source paths must refer to journals or notes in the reviewed range; the server validates them and adds linked references. Creates a new file and never overwrites. Do not substitute capture_note or capture_journal.",
      inputSchema: z.object({
        date: z.string().optional().describe("Save date YYYY-MM-DD; omit for today in the configured time zone. This is separate from the reviewed range."),
        from: z.string().describe("Inclusive start of the reviewed period, YYYY-MM-DD"),
        to: z.string().describe("Inclusive end of the reviewed period, YYYY-MM-DD"),
        title: z.string().trim().min(1),
        keyword: z.string().min(1).max(40).describe("Filename keyword; use a meaningful range or topic, with Unicode letters, numbers, underscores or hyphens"),
        content: z.string().trim().min(1).describe("Markdown review in the user's language. Label AI interpretations and keep actual user thoughts distinct. Cite source entries for observations. Do not fabricate patterns or thoughts."),
        sourcePaths: z.array(z.string().min(1)).min(1).describe("Copy exact path values from journal/note records read within from/to. Do not reconstruct filenames or use Markdown-relative links. Keep out-of-range historical comparisons and earlier reviews as citations in content, not in sourcePaths. Stored as metadata and relative Markdown links."),
      }),
      outputSchema: z.object({ path: z.string(), action: z.literal("created") }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ date, ...input }) => toolResult(await store.saveReview({ ...input, date: date ?? currentDate(timeZone) })),
  );

  server.registerTool(
    "get_records_by_date_range",
    {
      title: "Read records by date range",
      description:
        "Read journal entries and notes in any language within an inclusive date range, or saved reviews with types: ['review']. Review dates are save dates; the reviewed period is recorded as from/to in each review. Use this before weekly or monthly reviews and whenever the user asks what they recorded during a period. Preserve source-language quotations; explain or summarize in the language of the user's request.",
      inputSchema: z.object({
        from: z.string().describe("Inclusive start date in YYYY-MM-DD"),
        to: z.string().describe("Inclusive end date in YYYY-MM-DD"),
        types: z.array(recordTypeSchema).optional().describe("Defaults to journals and notes. Include review explicitly to retrieve saved interpretations; date filters use the save date, not the reviewed period."),
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
        "Search journal entries and notes for words or phrases in any language. Set types: ['review'] to search saved reviews separately; date filters use save dates. Reviews contain interpretations, not independent evidence. Use the user's original search terms when possible. Use this when the user asks whether, when, or how they previously mentioned a person, topic, feeling, event, or idea.",
      inputSchema: z.object({
        query: z.string().min(1),
        from: z.string().optional().describe("Optional start date in YYYY-MM-DD"),
        to: z.string().optional().describe("Optional end date in YYYY-MM-DD"),
        types: z.array(recordTypeSchema).optional().describe("Defaults to journals and notes. Include review explicitly to retrieve saved interpretations; date filters use the save date, not the reviewed period."),
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
