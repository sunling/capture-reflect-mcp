# Record filename conventions

File names are stable locations, not a summary that must be rewritten as the record evolves. Contents and headings may change without renaming a file. Stable record IDs, when available, remain optional metadata; the filename convention does not require an ID.

| Record | New filename | Purpose |
| --- | --- | --- |
| Daily journal | `journals/YYYY/YYYYMM/YYYYMMDD.md` | One container per date. Topics and original-language fragment headings belong inside. |
| Note | `notes/YYYY/YYYYMM/YYYYMMDD-short-topic.md` | A concise, recognizable topic in the note's own language; the full `title` stays in frontmatter. |
| Review | `reviews/YYYY/YYYYMM/FROMYYYYMMDD-TOYYYYMMDD-topic.md` | The directory uses the save date; filename describes the reviewed range and its subject. |

Example: `journals/2026/202609/20260916.md` may contain `### 早餐`, `### 工作进展`, and `### 晚间反思`; the first fragment does not define the whole day's filename. Existing `20260916-早餐.md` files are *not* renamed: the same-day capture discovers and appends to the existing file instead. If two journal files already exist for one date, capture stops rather than choosing or overwriting one. New daily journal files continue to have a day-level heading and an automatically generated optional stable ID; appends preserve existing metadata and filename.

Notes keep a brief topic-based basename such as `20260916-努力与选择.md`, while the complete title can be `努力与选择：可控性、调研与行动`. Do not translate a Chinese note to English (or vice versa) only to create its filename. The API currently calls this short filename segment `keyword` for backwards compatibility; treat it as a concise descriptive title, not a keyword list. Current note creation rejects identical paths rather than silently overwriting or auto-numbering; locate the original and use `update_record` for a true follow-up, or consciously select another distinct short topic for a separate note.

Review names and UUID format are unchanged. Attachments retain their existing dated keyword-based names to avoid accidental collisions; journal's `keyword` parameter remains accepted internally for backwards compatibility and attachment naming, even though it no longer affects the daily Markdown filename.

**Interoperability:** Relative Markdown links are path-based. Never bulk-rename old records as an incidental effect of this convention; moving a record requires checking inbound links and review `source_paths`. Any future migration should be explicit, auditable, and reversible. A record written manually in Obsidian remains valid without an ID; for current MCP date-range discovery, keep the date prefix and canonical directory layout.
