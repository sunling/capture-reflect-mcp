# Record filename conventions

Filenames are stable locators, not exhaustive summaries. The Markdown body carries the record and its explanation; optional `id` metadata carries identity. Do not require users to name a whole day after its first event.

| Record | New filename | Where the meaningful title lives |
| --- | --- | --- |
| Journal | `journals/YYYY/YYYYMM/YYYYMMDD.md` | Top heading: localized date and weekday. Each capture: its own `###` fragment heading. |
| Note | `notes/YYYY/YYYYMM/YYYYMMDD-short-topic.md` | Full `title` in frontmatter; short topic in the filename, in the original language. |
| Review | `reviews/YYYY/YYYYMM/FROMYYYYMMDD-TOYYYYMMDD-topic.md` | Full title and review range in metadata, with source evidence in `source_paths`. |

## Daily journal compatibility

`capture_journal` does not require `keyword` from a client. It creates only `YYYYMMDD.md` for a day with no existing journal; new captures for that same day append to that exact file. Legacy client calls that still send `keyword` are accepted, but the keyword does not affect the file path. When an older file such as `20260915-周二-旅行.md` already exists, continue appending to it rather than creating a second `20260915.md`. If multiple journal files share a date, reject the write and require the user to resolve the ambiguity. Explicit `update_record` accepts either date-only or legacy paths returned by record reads.

Do not bulk rename old journals. Renaming a Markdown file can break relative links from notes and reviews, so any later migration must audit and repair inbound references first. Existing optional IDs and user prose are unaffected.

## Notes and duplicate names

Pick a short *topic*, not a generic word or forced English translation: `20260916-努力与选择.md` is a recognizable filename for a longer title such as “努力与选择：可控性、调研与行动”. The existing `keyword` field remains the backward-compatible tool name for this short topic. The storage layer still rejects duplicate note paths instead of silently overwriting or creating a numbered copy; find and update the existing note when it is the same subject, or choose a different specific topic for a genuinely independent note. Automatic duplicate suffixes are **not** implemented by this change.

Review filename generation, image storage, sharded search indexes, graph links, and ID generation are otherwise unchanged. Indexes are derived from Markdown and may be rebuilt; no migration of personal records is part of this change.
