import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getBubbleBreakerContext } from "./bubble-breaker.js";
import { resolveDateRange } from "./date-range.js";
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
        "Choose capture_journal or capture_note based on the intended subject, not trigger words. Use capture_journal for lived experiences, feelings, events, or daily reflections; it creates a journal or automatically appends a new fragment for the same date. Use capture_note to create a new note for knowledge, encountered material, quotations, technical observations, measurements, product tests, design decisions, and ideas. When a user explicitly wants to add to or correct an existing journal or note, use update_record: first search/read the exact target path, then append new material or replace one uniquely matching exact excerpt. Do not create a duplicate note because its path exists. For example '记录日记时 durationMs 是 6685' is a technical note, not a journal, unless the user explicitly requests a journal. Journal and note content may be in any language; preserve the original language, wording, uncertainty, code-switching, and original note text verbatim; never translate unless requested. Keep AI connections and reflections separate and explicitly labeled. Reply in the language of the current request. When the user says today or gives no date, omit the date argument to use the server-configured time zone; supply dates only when explicitly specified. After a successful capture or edit, present recordUrl as a clickable Markdown link when returned. Read records before reviews or questions about prior records; follow review-records and save_review for requested saved reviews. Treat prior review interpretations as distinct from original evidence. To switch GitHub accounts use get_github_account_switch_link; to set up GitHub, change repositories or update the time zone use get_github_setup_link, not the AI client's reconnect action.",
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
      title: "Create or append a journal entry",
      description:
        "Record a personal journal fragment in the user's original language. Automatically create a journal file for the record date or append a new headed fragment to the existing journal for that date. Use for lived experiences, feelings, events and daily reflections, not technical debugging or ideas about the recording system (use capture_note). For a correction of existing journal text, or when the user explicitly identifies an existing journal path to update, use update_record after reading that file. Lightly edit for readability without inventing details or translating.",
      inputSchema: z.object({
        date: z.string().optional().describe("YYYY-MM-DD. Omit for today or unspecified date; the server uses its configured time zone. Supply only for an explicitly specified calendar date."),
        title: z.string().min(1).describe("Short factual fragment heading in the user's original language"),
        keyword: z.string().min(1).max(40).describe("Short filename keyword in the user's language; Unicode letters, combining marks, numbers, underscores and hyphens are supported"),
        content: z.string().min(1).describe("Markdown journal entry in the user's original language, without translation, invented summaries, or tags"),
        attachments: z.array(fileParamSchema).max(5).optional().describe("Optional image files supplied by the AI client"),
      }),
      outputSchema: captureResultSchema,
      _meta: { "openai/fileParams": ["attachments"] },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
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
      title: "Create a note",
      description:
        "Create a note in any language when the user asks to keep an article, book, podcast, video, course, conversation, quotation, link, something learned, technical observation, debugging finding, measurement, product test, design decision, or idea. Use update_record for additions or corrections to an existing note; locate its exact path first. The recording system itself is a note subject even if the content contains journal or 日记. Preserve the user's original text verbatim under Original note and include optional Source, Related journal entries, and Further reflection in the note's language. Unless skipped, search_records once with types: ['journal'], making at most three focused searches, and include up to three genuine connections with verified dates, relative links, exact excerpts, and explanations labeled Possible connection (AI). Label AI reflections as AI and omit empty sections. If lookup fails, save the original and disclose the failure. Honor explicitly requested formatting. Supplied Markdown is stored as-is; this tool does not automatically search or structure it. After saving show recordUrl if returned.",
      inputSchema: z.object({
        date: z.string().optional().describe("YYYY-MM-DD. Omit for today or unspecified date; the server uses its configured time zone. Supply only for an explicitly specified calendar date."),
        title: z.string().min(1).describe("Title in the user's original language"),
        keyword: z.string().min(1).max(40).describe("Short filename keyword in the user's language; Unicode letters, combining marks, numbers, underscores and hyphens are supported"),
        content: z.string().min(1).describe("Markdown with the user's original text verbatim under an Original note heading; optional verified Source, Related journal entries, and explicitly AI-labeled Further reflection. Use the note's language; omit empty optional sections and honor explicit formatting requests."),
        tags: z.array(z.string().min(1)).max(3).optional(),
        source: z.string().min(1).optional().describe("Source title or URL when available"),
        attachments: z.array(fileParamSchema).max(5).optional().describe("Optional image files supplied by the AI client"),
      }),
      outputSchema: z.object({
        path: z.string(),
        action: z.literal("created"),
        attachmentPaths: z.array(z.string()),
        recordUrl: z.string().url().optional(),
      }),
      _meta: { "openai/fileParams": ["attachments"] },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
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
    "update_record",
    {
      title: "Append to or edit an existing journal or note",
      description:
        "Update an existing journal or note in place. FIRST find and read the exact target using search_records (types journal or note) or get_records_by_date_range, then copy the returned path. Use mode append for new material: preserve existing content, add only new Markdown, and provide a suitable ### fragment heading for journals or ## section heading for notes when helpful. Use mode replace for corrections: pass exact unique oldText from the returned content and only the correction, never regenerate the whole document. For a normal new journal fragment capture_journal already creates/appends by date; use this tool for explicit updates to identified existing records. Do not guess a path or change a record based solely on a similar title; if targets are ambiguous ask the user to select. The server rejects absent, repeated, or ambiguous replacement text and duplicate appends, and retries GitHub commit conflicts. Show recordUrl when returned.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Exact journals/YYYY/YYYYMM/filename.md or notes/YYYY/YYYYMM/filename.md path returned by a record search/read; never invent it."),
        mode: z.enum(["append", "replace"]).describe("Append new material without removing old text or replace exactly one existing passage"),
        content: z.string().min(1).describe("Only the new Markdown to append or text replacing oldText; keep the original language and label AI-created additions."),
        oldText: z.string().min(1).optional().describe("Required for replace: a unique exact excerpt copied from the current record. Omit for append."),
      }),
      outputSchema: z.object({
        path: z.string(),
        action: z.enum(["appended", "updated"]),
        recordUrl: z.string().url().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!store.updateRecord) throw new Error("Record editing is unavailable in this records store.");
      return toolResult(await store.updateRecord(input));
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
        keyword: z.string().min(1).max(40).describe("Topic keyword in the user's language; omit dates because the server prefixes FROMYYYYMMDD-TOYYYYMMDD. Use Unicode letters, numbers, underscores or hyphens"),
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
        "Read journal entries and notes in any language within an inclusive date range, or saved reviews with types: ['review']. Omit both from and to for the last seven calendar days including today in the configured time zone. Honor any user-specified period instead. Reuse the returned from/to when saving a review. Review dates are save dates; the reviewed period is recorded as from/to in each review. Use this before weekly or monthly reviews and whenever the user asks what they recorded during a period. Preserve source-language quotations; explain or summarize in the language of the user's request.",
      inputSchema: z.object({
        from: z.string().optional().describe("Inclusive start date YYYY-MM-DD. Provide both dates for a custom period, or omit both for the last seven calendar days including today."),
        to: z.string().optional().describe("Inclusive end date YYYY-MM-DD. Provide together with from, or omit both."),
        types: z.array(recordTypeSchema).optional().describe("Defaults to journals and notes. Include review explicitly to retrieve saved interpretations; date filters use the save date, not the reviewed period."),
      }),
      outputSchema: z.object({ from: z.string(), to: z.string(), timeZone: z.string(), records: z.array(storedRecordSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ from, to, types }) => {
      const range = resolveDateRange({ from, to }, timeZone);
      return toolResult({
        from: range.from, to: range.to, timeZone: range.timeZone,
        records: await store.getRecords({ from: range.from, to: range.to, ...(types ? { types } : {}) }),
      });
    },
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
        types: z.array(recordTypeSchema).optional().describe("Defaults to journals and notes. Include review explicitly to retrieve saved reviews; date filters use save date, not reviewed period."),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: z.object({ records: z.array(searchRecordSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
