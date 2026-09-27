# Record filename conventions

File names are stable locations, not a summary that must be rewritten as the record evolves. Contents and headings may change without renaming a file. Stable record IDs, when available, remain optional metadata; the filename convention does not require an ID.

| Record | New filename | Purpose |
| --- | --- | --- |
| Daily journal | `journals/YYYY/YYYYMM/YYYYMMDD.md` | One container per date. Topics and original-language fragment headings belong inside. |
| Note | `notes/YYYY/YYYYMM/YYYYMMDD-english-slug.md` | A short lowercase ASCII slug; the original-language `title` stays in frontmatter. Multiple notes can share a date. |
| Review | `reviews/YYYY/YYYYMM/FROMYYYYMMDD-TOYYYYMMDD.md` | The directory uses the save date; the filename describes the reviewed range. One review per range. |

Example: `journals/2026/202609/20260916.md` may contain `### 早餐`, `### 工作进展`, and `### 晚间反思`; the first fragment does not define the whole day's filename. Existing `20260916-早餐.md` files are *not* renamed: the same-day capture discovers and appends to the existing file instead. If two journal files already exist for one date, capture stops rather than choosing or overwriting one. New daily journal files continue to have a day-level heading and an automatically generated optional stable ID; appends preserve existing metadata and filename.

Notes keep a brief English slug such as `20260916-effort-and-choice.md`, while the complete title can be `努力与选择：可控性、调研与行动`. Only the filename slug uses English; the title and body retain the user's language. The API calls this segment `keyword`. It accepts 1–40 lowercase ASCII letters or digits separated by single hyphens. Current note creation rejects identical paths rather than silently overwriting or auto-numbering; locate the original and use `update_record` for a true follow-up, or consciously select another distinct slug for a separate note.

Reviews use just the reviewed date range, such as `20260905-20260911.md`; the save date stays in frontmatter and determines the directory. Saving another review of the same range is rejected, even on a different day. Review editing requires an explicit separate workflow. New attachment names use dated ASCII keywords to avoid collisions. The journal's `keyword` parameter is optional and only affects attachment names; without one, it defaults to `journal`.

Existing Unicode filenames and links remain readable. Do not rename old records as an incidental effect of this convention; moving a record requires checking inbound links and review `source_paths`. Any future migration should be explicit, auditable, and reversible. A record written manually in Obsidian remains valid without an ID; for current MCP date-range discovery, keep the date prefix and canonical directory layout.
