# Portable knowledge graph (first implementation)

**Contract: No MCP required. No ID required. No database required.** The user's Markdown and ordinary links are the source of truth. This repository implements optional stable identity and a read-only, derived graph; it never makes a hosted graph service necessary to read, write, or link notes.

See [record filename conventions](file-naming.md) for the date-only daily journal, short-topic note, and range-based review naming rules.

## Files and identity

- New journal, note, and review documents written by Capture & Reflect receive an `id: cr_<uuid>` in normal YAML frontmatter. A day's later journal fragments keep the original ID. New daily journals are named `YYYYMMDD.md`; legacy journal filenames are preserved on append. IDs are not Git blob SHAs and are never recalculated from content or file location.
- Existing records, or files created while the MCP is unavailable, **do not need an ID**. They can be opened, edited and linked normally. Reading the graph never rewrites them or silently backfills metadata.
- **Current MCP import constraint:** `get_records_by_date_range` (also used by the graph tool) discovers journal/note records by date-prefixed filenames such as `journals/2026/202609/20260916.md` or `notes/2026/202609/20260916-行动.md`. A manually created file using the same convention is recognized without an ID; arbitrary Obsidian filenames remain usable in Obsidian but may not appear in MCP queries. Supporting arbitrary Markdown names is a separate importer improvement, not a reason to require users to invent IDs.
- ID-based lookup is optional; duplicate IDs cause an explicit error rather than selecting a possibly wrong record. A future explicit, collision-checked migration can add IDs to legacy files, but is not a prerequisite to using this graph.

## Portable links

Write meaningful ordinary Markdown links in the document body, e.g. from `notes/2026/202609/20260916-想法.md`:

```md
That decision reminds me of [the action note](20260916-行动.md): feedback matters more than merely repeating the plan.
```

GitHub, ordinary Markdown viewers, and Obsidian can follow a relative Markdown file link. The new `get_record_connections` MCP tool derives outgoing links and backlinks by reading discoverable records under `journals/`, `notes/`, and `reviews/`. There is **no separately written backlink** in the target document and no writable graph store to drift out of sync. The tool also reports unresolved local `.md` targets; it ignores image links, external URLs, and fenced/inline code. It recognizes standard inline and reference-style links, percent-encoded UTF-8 filenames, and optional file anchors. For now, it does not parse Obsidian-only `[[wikilinks]]`, shortcut reference links, or complicated nested-parentheses link syntax. Prefer standard inline links for portability.

To inspect connections, first retrieve/search the exact file, then invoke:

```json
{"path":"notes/2026/202609/20260916-行动.md"}
```

Alternatively pass `{"id":"cr_<uuid>"}` with no path. It returns the selected node, `outgoing`, `backlinks`, and `unresolved`. These are **syntactic links, not an endorsement of every relationship**: the existing capture skill can include clearly labeled `Possible connection (AI)` links. To establish a further permanent connection through an edit, the user should request/approve it. The read-only implementation scans records at query time, so very large repositories can be slower. An optional, rebuildable graph cache can be added later **without changing the Markdown contract**.

## Exit drill: MCP or hosted service stops working

1. Clone or download the user's records repository (or continue with an existing local checkout). Open the directory in Obsidian or any Markdown-capable editor. No plugin-specific import or database export is needed.
2. Create another Markdown note normally. **Do not handcraft an ID.** Link to other notes with relative Markdown links. If you want the current MCP to discover that new note on recovery, keep its existing `YYYYMMDD-<title>.md` naming convention; for daily journals, use `YYYYMMDD.md`. Obsidian itself does not require these names. Existing IDs, if present, remain ordinary YAML; do not alter or duplicate them.
3. If renaming or moving Markdown outside an editor that automatically updates links, fix affected links or use a link-audit/migration tool. Stable IDs protect identity but do **not** magically redirect GitHub's path-based Markdown URLs. The review-reference migration from PR #29 repairs review paths only.
4. If Capture & Reflect is restored, it can read conventionally named records, including new ID-less notes, and derive the links again without backfilling IDs or requiring another service. Arbitrary filenames need importer support before they participate in the MCP graph.

## Boundaries and future evolution

This first implementation adds a read-only graph view and optional IDs to **new** documents. It intentionally does not migrate old records, write relationships suggested by AI through the graph tool, rewrite existing links, change the search Bloom index, or promise faster graph queries. Markdown remains canonical; graph/search/index files, if added later, must be entirely rebuildable from it. A future ID/path resolver can make migration easier, but it must retain direct-path fallback.
