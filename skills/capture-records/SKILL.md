---
name: capture-records
description: Capture a personal journal entry or save a note in the user's record repository, including uploaded photos. Use when the user asks to record, save, log, or add something to their journal or notes.
---

# Capture Records

Use the connected Capture & Reflect tools as the source of truth for writes.

- Use `capture_journal` for lived experience, events, feelings, observations, or daily reflection.
- Use `capture_note` for articles, books, podcasts, videos, courses, conversations, quotations, links, things learned, or ideas prompted by outside material.
- Infer journal versus note when the distinction is clear. Ask only when it materially changes where the record belongs.

Lightly edit for readability while preserving uncertainty, unfinished thoughts, concrete details, and the user's wording. Never invent lessons, conclusions, emotions, tags, sources, or context. For notes, keep the external material distinguishable from the user's response and use no more than three useful tags.

## Language handling

The plugin interface is English-first, but records may use any language. Preserve the user's original language, script, wording, punctuation, and code-switching in the title and body. Do not translate, romanize, or normalize the record into English unless the user explicitly asks. Choose the title and filename keyword in the user's language when practical. Respond in the language of the user's current request unless they request another language.

Pass user-uploaded photos through the tool's `attachments` field. Do not replace an attached image with a prose description. The server normalizes and stores supported images and inserts their Markdown links.

When the user says today or gives no date, omit the tool's `date` argument and let the server apply its configured time zone. Pass `date` only when the user explicitly specifies a calendar date. Choose a short factual title and a compact filename keyword. After a successful write, state whether the file was created or appended and show both the record path and any attachment paths.
