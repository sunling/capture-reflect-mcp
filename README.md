# Capture & Reflect

`capture-reflect-mcp` is the open-source MCP server behind **Capture & Reflect**, a personal capture and reflection system. It lets an AI client capture and retrieve Markdown journal entries and notes, including photo attachments, through natural language while keeping the records in a separate local or GitHub repository.

It is designed to work with the directory conventions used by [`record-reflect-practice`](https://github.com/sunling/record-reflect-practice):

```text
journals/{YYYY}/{YYYYMM}/
notes/{YYYY}/{YYYYMM}/
reviews/
```

## Current scope

The local server exposes four record tools. The hosted service also exposes a secure setup tool:

- `capture_journal`: create or append a personal journal entry fragment, with optional photos.
- `capture_note`: save a Markdown note, with optional photos.
- `get_records_by_date_range`: retrieve journal entries and notes for review.
- `search_records`: search record contents.
- `get_github_setup_link`: authorize a GitHub App and choose a per-user records repository.

The MCP server handles access and storage. It publishes three focused Agent Skills through the MCP Skills extension so supported AI clients can discover their instructions and resources:

- `capture-record`: route one journal entry or note, preserve the user's voice, and pass uploaded photos through.
- `review-records`: review a date range using evidence from the stored records.
- `recall-records`: search before answering questions about earlier records.

## Terminology

- `journal entry`, `note`, `review`, and `record` refer to one item.
- `records` refers to a collection of journal entries and notes.
- `journals/`, `notes/`, `reviews/`, and `images/` refer to actual directories. Directory names are always lowercase, plural, wrapped in backticks, and include a trailing slash.
- Skill names follow their operation: `capture-record` writes one record, while `recall-records` and `review-records` may work across multiple records.

## Language support

The interface, tool names, and public metadata are English-first. Record content is multilingual: titles, Markdown bodies, source text, quotations, and filename keywords may use Unicode and keep the user's original language and code-switching. Capture tools do not translate unless the user explicitly asks. Recall and review responses follow the language of the current request while preserving source-language quotations.

Examples include “记录一下今天发生的事”, “Save this reflection”, “今日のメモを保存して”, and mixed-language notes.

## Safety boundaries

- The source repository contains no personal records or credentials.
- The server can only read `journals/` and `notes/`.
- New records are written only inside those two directories.
- Existing note files are never silently overwritten.
- If more than one journal file exists for a date, the write stops instead of guessing.
- Each capture accepts up to five image attachments. Images are resized to fit within 2048 × 2048 pixels, metadata is removed, and the processed file must be no larger than 10 MB.
- GitHub credentials are read from the environment and are never written into records.

## Connect to the hosted MCP

The hosted Capture & Reflect MCP is available at:

```text
https://api.bysunling.com/mcp
```

A supported remote MCP client can connect to this endpoint and complete OAuth. On first use, Capture & Reflect provides a secure GitHub setup link so the user can authorize the GitHub App, choose the repository where records should live, and save the detected time zone.

### Claude

In Claude:

1. Open **Customize → Connectors**.
2. Choose **Add custom connector**.
3. Name it `Capture & Reflect` and use `https://api.bysunling.com/mcp` as the MCP URL.
4. Connect and complete OAuth.
5. The first time you save a record, follow the GitHub setup link and choose your records repository.

Once connected, try: “帮我记录今天的日记”, “保存一条笔记”, “回看我最近七天的记录”, or “搜索我以前关于搬家的记录”.

The same hosted MCP can be used by other AI clients that support remote MCP with OAuth.

## Connect to ChatGPT Developer Mode

The quickest private test uses the local HTTP server plus ChatGPT's Secure MCP Tunnel. This keeps the unauthenticated development endpoint on your own computer.

Requirement: Node.js 22 or later. A local clone of your records repository is needed only for local storage.

```bash
npm install
cp .env.example .env
npm run build
```

For backward compatibility, the default local path remains `~/.log-reflect/records`; it is
created on the first write. To use an existing local records repository instead, set its absolute path as
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

Each capture creates a GitHub commit immediately. Journal
fragments for the same day are appended to the existing file with conflict retries; an existing
note is never overwritten. Reading and search remain limited to `journals/` and
`notes/`.

The GitHub token used by this MCP server is separate from any GitHub connector authorization in
an AI client. Never commit `.env`; it is already excluded by `.gitignore`.

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

Once connected, try: “帮我记录今天的日记”“把这张照片放进今天的日记”“保存一条笔记”“回看我最近七天的记录” or “搜索我以前关于搬家的记录”.

### ChatGPT plugin packaging

The first ChatGPT connection creates an app identifier such as `plugin_asdk_app...`. That identifier is intentionally not committed here. It can later be placed in `.app.json` when packaging the final installable plugin.

Official references: [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server), [connect it to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt), and [package a plugin](https://developers.openai.com/plugins/build/plugins).

### Photo attachments

In a supported AI client, attach one or more images to the message that asks to record a journal entry or save a note. Supported source formats are JPEG, PNG, WebP, HEIC, and AVIF. The client passes a temporary file URL to the plugin, which normalizes the image and stores it beside the Markdown record:

```text
journals/{YYYY}/{YYYYMM}/images/
notes/{YYYY}/{YYYYMM}/images/
```

The record contains relative Markdown image links, so it remains portable when the records repository is cloned or viewed on GitHub. Original EXIF metadata is not retained. Non-image attachments are rejected in this version.

> The local HTTP endpoint uses no authentication and binds to `127.0.0.1` by default. Do not expose it directly to the public internet. The Netlify entrypoint under `netlify/functions/` is the authenticated production endpoint.

## Hosted production deployment

The production architecture uses WorkOS AuthKit for MCP OAuth, a GitHub App for per-user repository access, Supabase for encrypted connection metadata, and Netlify Functions for the public HTTPS endpoint. Journal bodies and images are written directly to the repository selected by the user; they are not copied into Supabase.

1. Create a WorkOS AuthKit project. Enable CIMD and dynamic client registration, set the resource indicator to the stable public origin, and configure that origin as the default resource.
2. Create a public GitHub App with **Contents: Read and write** and **Metadata: Read** repository permissions. Enable expiring user tokens. Set the callback URL to `/github/callback` and setup URL to `/github/installed` on the public origin.
3. Create a dedicated Supabase project and apply `supabase/migrations/20260901051620_create_user_connections.sql`.
4. Create a Netlify site from this repository, attach the stable custom domain, and configure every variable in `.env.production.example` as a secret environment variable.
5. Connect `https://YOUR_DOMAIN/mcp` in a supported AI client, complete any required domain verification, scan the tools and Skills, and run the review test cases.

When a user saves a repository connection, Capture & Reflect initializes any missing canonical directories with harmless `.gitkeep` files:

```text
notes/
journals/
reviews/
```

Git does not track empty directories, so these marker files make the structure visible before the first record. Existing files are never replaced. A repository with no commits is initialized on its default branch.

## Scheduled reviews

The MCP server is passive: it exposes record and review capabilities but does not wake itself up on a schedule. The simplest hosted workflow is a scheduled task in a supported AI client that periodically invokes the `review-records` Skill, reads the chosen date range with `get_records_by_date_range`, and returns the review.

At present, scheduled reviews are read-only and are not written back to the records repository. Persisting them under `reviews/` requires a separate, narrowly scoped `save_review` MCP tool. A self-hosted alternative is a Netlify Scheduled Function plus an AI model call, but that adds model credentials, scheduling, retries, and delivery handling to this service.

Never expose `SUPABASE_SECRET_KEY`, `GITHUB_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `SETUP_TOKEN_SECRET` to a browser. Generate the latter two independently with a cryptographically secure random generator.

## Local stdio setup

Requirements: Node.js 22 or later.

```bash
npm install
cp .env.example .env
```

Optionally set the absolute path to an existing records repository. If it is omitted, the
server uses `~/.log-reflect/records`:

```bash
RECORDS_REPO_PATH=/absolute/path/to/record-reflect-practice
```

Build and start the stdio server (for Claude Desktop, Codex, and other local MCP clients):

```bash
npm run build
RECORDS_REPO_PATH=/absolute/path/to/record-reflect-practice npm run start:stdio
```

## Example client configuration

After building, point an MCP client at the compiled server:

```json
{
  "mcpServers": {
    "capture-reflect": {
      "command": "node",
      "args": ["/absolute/path/to/capture-reflect-mcp/dist/src/server.js"],
      "env": {
        "RECORDS_REPO_PATH": "/absolute/path/to/record-reflect-practice",
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
- Complete domain verification, privacy policy, tool scanning, test prompts, and ChatGPT plugin review.
- Add scheduled reflection and information-bubble-breaker workflows.
