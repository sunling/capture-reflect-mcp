# Portable knowledge graph (first implementation)

**Contract: No MCP required. No ID required. No database required.** The user's Markdown and ordinary links are the source of truth. This repository implements optional stable identity and a read-only, derived graph; it never makes a hosted graph service necessary to read, write, or link notes.

## Files and identity

- New journal, note, and review documents written by Capture & Reflect receive an `id: cr_<uuid>` in normal YAML frontmatter. A day's later journal fragments keep the original ID. Human-readable filenames stay unchanged. IDs are not Git blob SHAs and are never recalculated from content or file location.
- Existing records, or files created while the MCP is unavailable, **do not need an ID**. They can be opened, edited, linked, read, and queried by exact repository-relative path. Reading the graph never rewrites them or silently backfills metadata.
- ID-based lookup is optional; duplicate IDs cause an explicit error rather than selecting a possibly wrong record. A future explicit, collision-checked migration can add IDs to legacy files, but is not a prerequisite to using this graph.

## Portable links

Write meaningful ordinary Markdown links in the document body, e.g. from `notes/2026/202609/A.md`:

```md
That decision reminds me of [the action note](B.md): feedback matters more than merely repeating the plan.
```

GitHub, ordinary Markdown viewers, and Obsidian can follow a relative Markdown file link. The new `get_record_connections` MCP tool derives outgoing links and backlinks by reading `journals/`, `notes/`, and `reviews/` directly. There is **no separately written backlink** in the target document and no writable graph store to drift out of sync. The tool also reports unresolved local `.md` targets; it ignores image links, external URLs, and fenced/inline code. It recognizes standard inline and reference-style links, percent-encoded UTF-8 filenames, and optional file anchors. For now, it does not parse Obsidian-only `[[wikilinks]]`, shortcut reference links, or complicated nested-parentheses link syntax. Prefer standard inline links for portability.

To inspect connections, first retrieve/search the exact file, then invoke:

```json
{"path":"notes/2026/202609/20260916-行动.md"}
```

Alternatively pass `{"id":"cr_<uuid>"}` with no path. It returns the selected node, `outgoing`, `backlinks`, and `unresolved`. The read-only implementation scans the records at query time, so very large repositories can be slower. An optional, rebuildable graph cache can be added later **without changing the Markdown contract**.

## Exit drill: MCP or hosted service stops working

1. Clone or download the user's records repository (or continue with an existing local checkout). Open the directory in Obsidian or any Markdown-capable editor. No plugin-specific import or database export is needed.
2. Create another Markdown note normally. **Do not handcraft an ID.** Link to other notes with relative Markdown links. Existing IDs, if present, remain ordinary YAML; do not alter or duplicate them.
3. If renaming or moving Markdown outside an editor that automatically updates links, fix affected links or use a link-audit/migration tool. Stable IDs protect identity but do **not** magically redirect GitHub's path-based Markdown URLs. The separate review-reference migration proposed in PR #29 repairs review paths only.
4. If Capture & Reflect is restored, it can read all records, including new ID-less notes, and derive the links again without backfilling IDs or requiring another service.

## Boundaries and future evolution

This first implementation adds a read-only graph view and optional IDs to **new** documents. It intentionally does not migrate old records, write relationships suggested by AI, rewrite existing links, change the search Bloom index, or promise faster graph queries. A user must confirm meaningful new connections before a client edits a note. Markdown remains canonical; graph/search/index files, if added later, must be entirely rebuildable from it. A future ID/path resolver can make migration easier, but it must retain direct-path fallback.
