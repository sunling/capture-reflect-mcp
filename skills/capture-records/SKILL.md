---
name: capture-records
description: Capture a personal journal entry or an external input in the user's record repository, including uploaded photos. Use when the user asks to record, save, log, or add something to their journal or inputs.
---

# Capture Records

Use the connected Log Reflect tools as the source of truth for writes.

- Use `capture_journal` for lived experience, events, feelings, observations, or daily reflection.
- Use `capture_input` for articles, books, podcasts, videos, courses, conversations, quotations, links, or ideas prompted by outside material.
- Infer journal versus input when the distinction is clear. Ask only when it materially changes where the record belongs.

Lightly edit for readability while preserving uncertainty, unfinished thoughts, concrete details, and the user's wording. Never invent lessons, conclusions, emotions, tags, sources, or context. For inputs, keep the external material distinguishable from the user's response and use no more than three useful tags.

Pass user-uploaded photos through the tool's `attachments` field. Do not replace an attached image with a prose description. The server normalizes and stores supported images and inserts their Markdown links.

Use the current date in the user's configured time zone unless another date is specified. Choose a short factual title and a compact filename keyword. After a successful write, state whether the file was created or appended and show both the record path and any attachment paths.
