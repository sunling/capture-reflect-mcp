# Review source references

## One source inventory, readable citations

New reviews keep their complete, validated source inventory **only** in YAML `source_paths`. The body contains targeted, short Markdown links next to the claims they support, e.g. `[9/14 工作噪音](../../../journals/2026/202609/20260914-%E5%91%A8%E4%B8%80-%E5%B7%A5%E4%BD%9C%E5%99%AA%E9%9F%B3.md)`. The server no longer automatically appends a second list of every source at the bottom. Historical reviews are not silently rewritten.

`source_paths` remains repository-relative and machine-readable. Body links remain ordinary GitHub-compatible, relative Markdown links; folder or file renames can break both. This phase does **not** introduce permanent record IDs or automatic redirects.

## Repair review references after a move

The migration command operates on a **local checkout of the records repository**, not the MCP code repository or the hosted service. Use a clean Git working tree and inspect the diff before committing. It does not move files for you, modify personal records, or write to GitHub directly.

First move the actual journal or note using `git mv` or an equivalent file operation. For example, after renaming one note:

```bash
git mv notes/2026/202609/20260914-old.md notes/2026/202609/20260914-new.md
node /path/to/capture-reflect-mcp/scripts/migrate-review-sources.mjs --repo . \
  --from notes/2026/202609/20260914-old.md \
  --to notes/2026/202609/20260914-new.md
```

The first run is **dry-run**: it reports which reviews would change and checks whether all referenced local Markdown files exist. Once the report has no `broken` references:

```bash
node /path/to/capture-reflect-mcp/scripts/migrate-review-sources.mjs --repo . \
  --from notes/2026/202609/20260914-old.md \
  --to notes/2026/202609/20260914-new.md --write
```

The `--from` and `--to` values can also be directory prefixes **inside the same journal/note root**. Do not rename the canonical root directories `journals/` or `notes/` with this script: the MCP's capture, validation, search/index, and editing code must be migrated separately. Avoid moving records into a date directory that does not match their date/filename conventions.

The migration updates `source_paths`, ordinary relative Markdown links (including percent-encoded Unicode paths), reference-style link definitions, and legacy backticked repository paths in reviews. It preserves inline link labels and does not strip legacy source-list footers. It never changes the underlying journal/note content, and it refuses to write the batch when broken source paths or parsed local `.md` links are found. Its Markdown parser targets common inline and reference-style links, not arbitrary HTML or complex link syntaxes; inspect unusual links manually.

Audit the checkout at any time, without a move:

```bash
node /path/to/capture-reflect-mcp/scripts/migrate-review-sources.mjs --repo .
```

A nonempty `broken` report makes the command exit with status 1. Review `git diff`, commit the record move and repaired reviews together, and let Capture & Reflect rebuild stale search index metadata on the next search. Only references **within reviews** are covered by this tool; if journals or notes also link to the moved item, repair those references separately.
