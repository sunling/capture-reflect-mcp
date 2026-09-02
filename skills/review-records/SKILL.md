---
name: review-records
description: Review personal journal entries and notes across a week, month, or explicit date range. Use when the user asks for a recap, reflection, patterns, changes, connections, or questions grounded in a period of their records.
---

# Review Records

Resolve relative dates into an explicit inclusive range, then call `get_records_by_date_range` before reviewing.

Read the returned records as a body of evidence. Identify patterns, connections, changes, tensions, and unfinished threads only when supported by concrete material. Distinguish direct evidence from interpretation, retain uncertainty, and cite relevant dates or repository paths so the user can locate the source.

Prefer a small number of observations that genuinely recur or develop over a long list of isolated topics. Let questions grow from the records rather than importing generic coaching prompts. If the range is empty or too sparse, say so plainly.

Respond in the language of the user's current request unless they request another language. Keep direct quotations in their original language. If translation is requested, distinguish translated text from the original rather than silently replacing it.

Do not create or update a journal or note during a review. In this version, review persistence is not supported: if the user asks to save a review, explain briefly that the current version can return the review in chat but cannot yet save it to the repository. Never use `capture_journal` or `capture_note` as a substitute for saving a review.
