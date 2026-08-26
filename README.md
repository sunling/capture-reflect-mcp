# log-reflect-mcp

`log-reflect-mcp` is a local-first MCP server and ChatGPT plugin scaffold for a personal recording system. It lets an AI client capture and retrieve Markdown records through natural language while keeping the records in a separate repository.

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

## Connect to ChatGPT Developer Mode

The quickest private test uses the local HTTP server plus ChatGPT's Secure MCP Tunnel. This keeps the unauthenticated development endpoint on your own computer.

Requirements: Node.js 22 or later and a local clone of your records repository.

```bash
npm install
cp .env.example .env
npm run build
```

Set `RECORDS_REPO_PATH` in `.env`, then load it and start the Streamable HTTP endpoint:

```bash
set -a
source .env
set +a
npm run start:http
```

Check that it is running:

```bash
curl http://127.0.0.1:3000/health
```

Next, create a tunnel in [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), run `tunnel-client` on this computer, and configure its HTTP target as:

```text
http://127.0.0.1:3000/mcp
```

Keep both `npm run start:http` and `tunnel-client run --profile <your-profile>` running. Then open **Settings → Security and login → Developer mode** in ChatGPT. On the [ChatGPT Plugins page](https://chatgpt.com/admin/plugins), create an app, choose **Tunnel**, and select or paste your `tunnel_id`. See the [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for installing and initializing `tunnel-client`.

Once connected, try: “帮我记录今天的日记”“记录一个输入”“回看我最近七天的记录” or “搜索我以前关于搬家的记录”.

> The current HTTP endpoint uses no authentication and binds to `127.0.0.1` by default. Do not expose it directly to the public internet. A hosted version that accesses private GitHub repositories must add OAuth 2.1 before deployment; ChatGPT does not accept a custom static API key for this flow.

The first ChatGPT connection creates an app identifier such as `plugin_asdk_app...`. That identifier is intentionally not committed here. It can later be placed in `.app.json` when packaging the final installable plugin.

Official references: [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server), [connect it to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt), and [package a plugin](https://developers.openai.com/plugins/build/plugins).

## Local stdio setup

Requirements: Node.js 22 or later.

```bash
npm install
cp .env.example .env
```

Set the absolute path to your records repository:

```bash
RECORDS_REPO_PATH=/absolute/path/to/log-reflect-practice
```

Build and start the stdio server (for Claude Desktop, Codex, and other local MCP clients):

```bash
npm run build
RECORDS_REPO_PATH=/absolute/path/to/log-reflect-practice npm run start:stdio
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
- Add a GitHub-backed storage adapter with repository selection.
- Add OAuth 2.1 for a hosted multi-user endpoint.
- Add scheduled reflection and information-bubble-breaker workflows.
