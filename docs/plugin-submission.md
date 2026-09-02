# Plugin submission notes

## Listing

- **Name:** Capture & Reflect
- **Short description:** Capture what matters, then revisit and reflect.
- **Long description:** Capture journals, notes, and uploaded photos in your own GitHub repository through natural language. Revisit earlier records, search what you captured, and reflect on patterns over time while keeping your repository as the source of truth.
- **Category:** Productivity
- **Website:** https://api.bysunling.com/
- **Support:** https://api.bysunling.com/support
- **Privacy:** https://api.bysunling.com/privacy
- **Terms:** https://api.bysunling.com/terms
- **MCP URL type:** Universal
- **MCP URL:** https://api.bysunling.com/mcp

## Starter prompts

1. Record today's journal entry in my original language.
2. Save this podcast idea as a note.
3. Save this photo in today's journal.
4. What did I record about this topic before?
5. Review my records from the past seven days.

## Positive test cases

### 1. Capture a journal entry
**Prompt:** Record that I felt scattered this morning, but after a walk I was able to focus again.

**Expected behavior:** Use the capture-records skill and call `capture_journal`. Do not translate or invent conclusions. Omit the date argument when the user means today so the configured time zone is applied.

**Expected result:** A Markdown journal record is created or appended under `journals/{YYYY}/{YYYYMM}/`, and the response reports the record path.

**Fixture:** Connected reviewer GitHub repository.

### 2. Capture a note from an external source
**Prompt:** Save a note: I heard the phrase “gig economy” in a podcast today and want to remember to learn what it means.

**Expected behavior:** Use `capture_note`, preserve the user's wording, and keep the external source/idea distinguishable from the user's response.

**Expected result:** A Markdown note is created under `notes/{YYYY}/{YYYYMM}/` and the response reports the path.

**Fixture:** Connected reviewer GitHub repository.

### 3. Capture an uploaded photo
**Prompt:** Put this photo in today's journal and note that I was testing image capture.

**Expected behavior:** Use `capture_journal` with the uploaded image in `attachments`.

**Expected result:** The normalized image is stored in the journal month `images/` directory and linked from the Markdown record.

**Fixture:** Connected reviewer GitHub repository and one supported image upload.

### 4. Recall an earlier record
**Prompt:** What did I previously record about focus?

**Expected behavior:** Use the recall-records skill and call `search_records` before answering.

**Expected result:** Return relevant records/excerpts grounded in stored journal/note content, with dates or paths so the user can locate the sources.

**Fixture:** Reviewer repository containing at least one journal or note that includes the word “focus”.

### 5. Review the past seven days
**Prompt:** Review my records from the past seven days. Where has my attention been going?

**Expected behavior:** Use the review-records skill, resolve the inclusive seven-day range, call `get_records_by_date_range`, and identify only patterns supported by the records.

**Expected result:** A concise reflection grounded in retrieved records. No repository write occurs.

**Fixture:** Reviewer repository containing records across the requested seven-day range.

## Negative test cases

### 1. Do not save a review as a journal or note
**Prompt:** Save the weekly review you just gave me.

**Expected behavior:** Explain that review persistence is not supported in this version.

**Why:** There is no dedicated review write tool. The plugin must not substitute `capture_journal` or `capture_note`.

### 2. Do not invent prior records
**Prompt:** Tell me what I wrote last month about moving apartments.

**Expected behavior:** Search stored records first. If no matching records exist, say that no matching evidence was found.

**Why:** Recall must be grounded in the user's repository and must not fabricate personal history.

### 3. Do not silently overwrite an existing note
**Scenario:** A capture request would generate a note path that already exists.

**Expected behavior:** The write fails safely rather than replacing the existing note without confirmation.

**Why:** Existing notes are not silently overwritten.

## Release notes

Initial public submission of Capture & Reflect.

Capture & Reflect connects ChatGPT to a GitHub repository selected by the user. It supports capturing journal entries, notes, and uploaded photos; searching and recalling prior records; and reviewing records across a date range. Records remain in the user's repository. The first release intentionally keeps review persistence read-only: reviews can be generated in chat but are not written back to the repository.

The hosted MCP endpoint is `https://api.bysunling.com/mcp`. GitHub repository selection and time zone setup are handled through the secure setup flow at `api.bysunling.com`. The setup page automatically detects the browser time zone.
