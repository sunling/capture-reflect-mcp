# log-reflect-mcp

`log-reflect-mcp` is an MCP server and ChatGPT plugin scaffold for a personal recording system. It lets an AI client capture and retrieve Markdown records through natural language while keeping the records in a separate local or GitHub repository.

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
- GitHub credentials are read from the environment and are never written into records.

## Connect to ChatGPT Developer Mode

The quickest private test uses the local HTTP server plus ChatGPT's Secure MCP Tunnel. This keeps the unauthenticated development endpoint on your own computer.

Requirement: Node.js 22 or later. A local clone of your records repository is needed only for local storage.

```bash
npm install
cp .env.example .env
npm run build
```

By default, records are stored under `~/.log-reflect/records`, which is created on the first
write. To use an existing local records repository instead, set its absolute path as
`RECORDS_REPO_PATH` in `.env`.

### Store records directly in GitHub

Create a fine-grained personal access token for only the records repository. Grant it
**Contents: Read and write**; no broader account or organization permissions are needed. Keep
the repository private if the records are personal, and put the following values in `.env`:

```bash
RECORDS_STORAGE=github
RECORDS_GITHUB_REPOSITORY=YOUR_GITHUB_USERNAME/YOUR_RECORDS_REPOSITORY
RECORDS_GITHUB_TOKEN=github_pat_...
RECORDS_GITHUB_BRANCH=main
RECORDS_TIME_ZONE=America/Los_Angeles
```

The target branch must already exist. Each capture creates a GitHub commit immediately. Journal
fragments for the same day are appended to the existing file with conflict retries; an existing
input note is never overwritten. Reading and search remain limited to `daily/journal/` and
`daily/inputs/`.

The GitHub token used by this MCP server is separate from any GitHub connector authorization in
ChatGPT. Never commit `.env`; it is already excluded by `.gitignore`.

Load the environment and start the Streamable HTTP endpoint:

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

Optionally set the absolute path to an existing records repository. If it is omitted, the
server uses `~/.log-reflect/records`:

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

For GitHub-backed stdio, replace `RECORDS_REPO_PATH` in the client environment with
`RECORDS_STORAGE`, `RECORDS_GITHUB_REPOSITORY`, `RECORDS_GITHUB_TOKEN`, and
`RECORDS_GITHUB_BRANCH` as shown above.

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
- Add repository selection UI for GitHub-backed storage.
- Add OAuth 2.1 for a hosted multi-user endpoint.
- Add scheduled reflection and information-bubble-breaker workflows.
