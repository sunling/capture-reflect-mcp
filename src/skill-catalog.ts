import type { McpServer } from "@modelcontextprotocol/server";

export function registerSkills(server: McpServer): void {
  server.registerSkill({
    name: "capture-record",
    title: "Capture a journal entry or note",
    description:
      "Capture one personal record. Route lived experience to a journal entry and encountered or learned material to a note while preserving the user's language and voice.",
    instructions: `Use the record tools narrowly and preserve the user's own language.

- Use \`capture_journal\` for lived experience, events, feelings, observations, and daily reflection.
- Use \`capture_note\` for encountered or learned material such as articles, books, podcasts, videos, conversations, quotations, links, or ideas prompted by outside material.
- Do not translate unless the user explicitly asks.
- Preserve uncertainty, unfinished thoughts, and code-switching.
- When the user says today or gives no date, omit the date argument so the server applies the configured time zone.
- When GitHub is not configured, call \`get_github_setup_link\` and give the user the returned setup URL.
- Optional image attachments may be passed through when the AI client supplies compatible temporary file URLs.`,
  });

  server.registerSkill({
    name: "review-records",
    title: "Review records",
    description:
      "Review journal entries and notes over a date range using evidence from the stored records.",
    instructions: `Use \`get_records_by_date_range\` before producing a review.

- Read the requested date range first rather than relying on conversation memory.
- Identify patterns, changes, connections, tensions, and unfinished threads that are supported by the records.
- Keep quotations in their original language.
- Explain or summarize in the language of the user's current request unless they ask otherwise.
- Do not invent motives or conclusions not supported by the records.
- If the material is sparse, say so rather than forcing a pattern.`,
  });

  server.registerSkill({
    name: "recall-records",
    title: "Recall earlier records",
    description:
      "Search personal records before answering questions about previously recorded people, topics, feelings, events, or ideas.",
    instructions: `Use \`search_records\` when the user asks whether, when, or how they previously mentioned something.

- Search using the user's original terms when possible.
- If the question names a date range, pass that range to the search tool.
- Distinguish what the records actually say from your interpretation.
- Preserve source-language quotations.
- If there is no matching record, say that no matching stored record was found rather than guessing.`,
  });
}
