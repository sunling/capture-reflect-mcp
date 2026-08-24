# log-reflect-mcp

`log-reflect-mcp` is a local-first MCP server for a personal recording system. It gives an AI client a small, explicit interface for capturing and retrieving Markdown records while keeping the records in a separate repository.

It is designed to work with the directory conventions used by [`log-reflect-practice`](https://github.com/sunling/log-reflect-practice):

```text
daily/
├── journal/{YYYY}/{YYYYMM}/
└── inputs/{YYYY}/{YYYYMM}/
practices/
```

## Current scope

The first version intentionally exposes only four tools:

- `capture_journal`: create or append a personal journal fragment.
- `capture_input`: save an external input as a Markdown note.
- `get_records_by_date_range`: retrieve journal and input records for review.
- `search_records`: search record contents.

The MCP server handles access and storage. Agent Skills remain responsible for judgment: how lightly to edit a journal, what belongs in an input note, how to review seven days, and when a recurring theme is ready to become a Practice.

## Safety boundaries

- The source repository contains no personal records or credentials.
- The server can only read `daily/journal/` and `daily/inputs/`.
- New records are written only inside those two directories.
- Existing input files are never silently overwritten.
- If more than one journal file exists for a date, the write stops instead of guessing.

## Setup

Requirements: Node.js 22 or later.

```bash
npm install
cp .env.example .env
```

Set the absolute path to your records repository:

```bash
RECORDS_REPO_PATH=/absolute/path/to/log-reflect-practice
```

Build and start the stdio server:

```bash
npm run build
RECORDS_REPO_PATH=/absolute/path/to/log-reflect-practice npm start
```

## Example client configuration

After building, point an MCP client at the compiled server:

```json
{
  "mcpServers": {
    "log-reflect": {
      "command": "node",
      "args": ["/absolute/path/to/log-reflect-mcp/dist/src/server.js"],
      "env": {
        "RECORDS_REPO_PATH": "/absolute/path/to/log-reflect-practice",
        "RECORDS_TIME_ZONE": "America/Los_Angeles"
      }
    }
  }
}
```

## Development

```bash
npm run check
npm test
```

To inspect the tools interactively:

```bash
npx @modelcontextprotocol/inspector node dist/src/server.js
```

## Roadmap

- Add MCP resources for reading individual records.
- Add review and develop-practice prompts without moving judgment into storage code.
- Add an opt-in Git commit workflow.
- Add a GitHub-backed storage adapter.
- Add Streamable HTTP and OAuth only after the local workflow is stable.

