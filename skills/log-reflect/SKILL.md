---
name: log-reflect
description: Capture, search, retrieve, and review the user's personal journal entries and input notes. Use when the user asks to record a diary or lived experience, save an external input or idea, recall something from their records, review a date range, or interact with their personal record repository.
---

# Log Reflect

Use the connected Log Reflect tools as the source of truth for personal records.

## Route the request

- Use `capture_journal` for the user's lived experience, events, feelings, observations, or daily reflection.
- Use `capture_input` for articles, books, podcasts, videos, courses, conversations, quotations, links, or ideas prompted by outside material.
- Use `get_records_by_date_range` before weekly, monthly, or other period reviews.
- Use `search_records` when the user asks whether, when, or how they previously mentioned a topic, person, feeling, event, or idea.
- Infer journal versus input when the distinction is clear. Ask a short question only when the classification materially changes the saved record.

## Preserve the user's voice

- Lightly edit for readability, but retain uncertainty, unfinished thoughts, concrete details, and the user's own wording.
- Never invent lessons, conclusions, emotions, tags, sources, or context.
- Use the current date in the user's configured time zone unless they specify another date.
- Choose a short factual title and a compact filename keyword.
- For inputs, keep source material distinguishable from the user's personal response. Include a source URL or title when available and use no more than three useful tags.

## Read and review

- Resolve relative date phrases into an explicit inclusive date range before reading.
- Ground summaries and patterns only in returned records. Distinguish direct evidence from interpretation.
- If search results are insufficient, refine the query or date range instead of guessing.
- Mention relevant dates or paths so the user can locate the underlying Markdown files.
- Do not write a new record during a review unless the user explicitly asks to save it.

## Confirm writes

After a successful write, briefly confirm whether the file was created or appended and show its repository-relative path. Never store credentials, access tokens, or unrelated private content.
