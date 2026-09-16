# Capture & Reflect

`capture-reflect-mcp` is the open-source MCP server behind **Capture & Reflect**, a personal capture and reflection system. It lets an AI client capture and retrieve Markdown journal entries and notes, including photo attachments, through natural language while keeping the records in a separate local or GitHub repository.

It is designed to work with the directory conventions used by [`capture-reflect-practice`](https://github.com/sunling/capture-reflect-practice):

```text
journals/{YYYY}/{YYYYMM}/
notes/{YYYY}/{YYYYMM}/
reviews/
```

## Current scope

The local server exposes six record and context tools. The hosted service also exposes secure setup and account-switch tools:

- `capture_journal`: create or append a personal journal entry fragment, with optional photos.
- `capture_note`: save a Markdown note preserving the original text, with optional source, related journal entries, AI-labeled reflections, and photos.
- `get_records_by_date_range`: retrieve journals and notes, or saved reviews with `types: ["review"]` (filtered by save date).
- `save_review`: save a review and validated source links under `reviews/`, without overwriting.
- `search_records`: search journals and notes by default; use `types: ["review"]` for earlier reviews.
- `get_bubble_breaker_context`: read recent journals and notes, current date/time, and the Bubble Breaker workflow; defaults to the last seven calendar days in the configured time zone.
- `get_github_setup_link`: authorize a GitHub App and choose a per-user records repository.
- `get_github_account_switch_link`: open GitHub account selection directly, including when the old authorization has expired.

The MCP server handles access and storage. It publishes four focused Agent Skills through the MCP Skills extension so supported AI clients can discover their instructions and resources:

- `capture-record`: route one journal entry or note, preserve the user's voice, and pass uploaded photos through.
- `review-records`: review a date range and save its sources, patterns, questions, and reflections unless chat-only output is requested.
- `recall-records`: search before answering questions about earlier records.
- `bubble-breaker`: discover one verified unfamiliar resource, record completion with minimal effort, or explore perspectives, blind spots, connections, and questions.

### Note capture workflow

The capture skill keeps the user's text verbatim in an **Original note** section. **Source**, **Related journal entries**, and **Further reflection** are optional, with headings in the note's language. Any AI-generated connections or reflections are labeled separately from the original text.

Before saving, the client starts with one focused `search_records` query restricted to journals and only runs another when the first result is clearly insufficient, with at most three searches total. It reads the results and includes up to three meaningful connections with dates, relative file links, and exact excerpts. Search currently matches literal text; it may miss related experiences expressed differently. Empty sections are omitted, and a failed lookup does not prevent saving the original note. Users can request another format or skip enrichment.

This is a client workflow defined by the bundled skill and tool instructions. `capture_note` still accepts Markdown `content`; the storage layer does not automatically search, enforce sections, or rewrite existing notes.

Capture routing follows the intended subject rather than isolated trigger words. Lived experiences and feelings go to `capture_journal`; technical observations, measurements, product tests, debugging findings, and design decisions go to `capture_note`, even when they discuss journals or the recording workflow itself. An explicit request to save something as a journal overrides the inferred subject.

### Sharded GitHub search index

GitHub-backed repositories use a v2 search index under `.capture-reflect/index-v2/`. The manifest references smaller shards grouped by record type and year; nonstandard legacy paths use deterministic hash buckets. Captures update only the affected shard and the manifest in the same atomic commit as the Markdown record and any images.

When only `.capture-reflect/search-index-v1.json` exists, the next successful capture or search reuses its Bloom filters to create v2 without rereading every record body. The v1 file is retained during the compatibility period but is no longer updated after v2 exists. Search validates per-shard digests against the current Git tree and rebuilds stale shards from changed records. Markdown under `journals/`, `notes/`, and `reviews/` remains the source of truth; all `.capture-reflect/` data is rebuildable.

### Bubble Breaker workflow

Ask “Find one unfamiliar resource for me” or “帮我突破信息茧房，推荐一个陌生输入”. The client explores varied domains and sources with its own web tools, independently of inferred interests. Before recommending one verified resource, it uses `get_bubble_breaker_context` and focused `search_records` queries to filter familiar territory and repeats. History filters candidates; it does not determine every destination. The MCP does not browse or generate recommendations itself. Other modes are `challenge`, `blindspot`, `connect`, and `socratic`.

Recommendations stay in chat. Once you explicitly report completion, the client checks notes for an existing completion and saves a minimal record through `capture_note`, with `input` and `bubble-breaker` tags and no automatic journal enrichment or required summary. The configured time zone replaces the reference skill's fixed time zone. Search-based duplicate checks are not atomic; existing notes cannot be appended, so an explicitly requested repeat completion can be saved separately. Scheduling requires a supported client.

## Terminology

- `journal entry`, `note`, `review`, and `record` refer to one item.
- `records` refers to a collection of journal entries and notes.
- `journals/`, `notes/`, `reviews/`, and `images/` refer to actual directories. Directory names are always lowercase, plural, wrapped in backticks, and include a trailing slash.
- Skill names follow their operation: `capture-record` writes one record, while `recall-records` and `review-records` may work across multiple records.

## Language support

The interface, tool names, and public metadata are English-first. Record content is multilingual: titles, Markdown bodies, source text, quotations, and filename keywords may use Unicode and keep the user's original language and code-switching. Capture tools do not translate unless the user explicitly asks. Recall and review responses follow the language of the current request while preserving source-language quotations.

New journal filenames use `{YYYYMMDD}-{keyword}.md`, without a language-specific weekday. Existing journals retain their filenames and are still appended to by date. Filename keywords support Unicode letters, combining marks, and numbers. Image attachments accept an optional `alt` description in the user’s language, falling back to the filename stem or an empty description.

Examples include “记录一下今天发生的事”, “Save this reflection”, “今日のメモを保存して”, and mixed-language notes.

## Safety boundaries

- The source repository contains no personal records or credentials.
- The server can only read `journals/`, `notes/`, and `reviews/`. Reviews must be requested explicitly and are excluded from default reads and searches.
- New records are written only inside those three directories. Reviews are create-only; source paths must identify existing journals or notes within the reviewed period.
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

### Account selection during Connect

For GitHub account and repository selection before returning to ChatGPT, enable the optional [Standalone Connect flow](docs/standalone-connect.md). This requires WorkOS configuration, a server API key, a GitHub callback and email permission, and explicit migration of existing identities. Deploying code alone does not enable it. Once activated, disconnecting and reconnecting the plugin starts GitHub account selection; the separate setup tool remains available for repository changes within that account.

### Switch GitHub accounts with the original hosted-auth flow

Ask “Switch the GitHub account for my records”. The client calls `get_github_account_switch_link` and returns a fresh link that opens GitHub’s account picker directly. Select or sign into the desired account, then choose a repository and click **Save & connect**. The general `get_github_setup_link` page also shows the current username and **Use a different GitHub account**. Grant the GitHub App access to that repository if needed.

Disconnecting the plugin in ChatGPT does not clear the server's saved GitHub connection. Account switching uses GitHub's account picker and does not require clearing browser cookies. The old connection remains until authorization succeeds; successful reauthorization clears the previous repository selection, so a repository must be selected before captures resume. Existing records stay in their original repository.

### Claude

In Claude:

1. Open **Customize → Connectors**.
2. Choose **Add custom connector**.
3. Name it `Capture & Reflect` and use `https://api.bysunling.com/mcp` as the MCP URL.
4. Connect and complete OAuth.
5. The first time you save a record, follow the GitHub setup link and choose your records repository.

### ChatGPT

In ChatGPT with Developer mode available:

1. Open **Settings → Security and login** and enable **Developer mode**.
2. Open **Plugins** and create a developer plugin connected to the hosted MCP endpoint.
3. Use `https://api.bysunling.com/mcp` as the MCP URL, then complete OAuth and tool scanning.
4. The first time you save a record, follow the GitHub setup link and choose your records repository.

Once connected in either client, try: “帮我记录今天的日记”, “保存一条笔记”, “回看我最近七天的记录”, or “搜索我以前关于搬家的记录”.

The same hosted MCP can be used by other AI clients that support remote MCP with OAuth.

## Local development with ChatGPT

For local development with ChatGPT, use the local HTTP server plus ChatGPT's Secure MCP Tunnel. This keeps the unauthenticated development endpoint on your own computer.

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
note is never overwritten. Reading and search remain limited to `journals/`, `notes/`, and explicitly requested
`reviews/`.

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

## Photo attachments

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

The review skill finishes by calling `save_review` unless the user requests chat-only output. Reviews are saved as `reviews/YYYY/YYYYMM/YYYYMMDD-keyword.md`, with the save date, reviewed range, source paths and links, and the full review body. Source links reference current entries rather than immutable snapshots. User thoughts remain distinct from AI interpretations. Empty periods are not saved; sparse evidence is labeled. Existing reviews are never overwritten. Retrieve earlier reviews with `types: ["review"]`; date filters use the save date, while the reviewed period is stored in `from`/`to` metadata. A self-hosted alternative is a Netlify Scheduled Function plus an AI model call, but that adds model credentials, scheduling, retries, and delivery handling to this service.

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
RECORDS_REPO_PATH=/absolute/path/to/capture-reflect-practice
```

Build and start the stdio server (for Claude Desktop, Codex, and other local MCP clients):

```bash
npm run build
RECORDS_REPO_PATH=/absolute/path/to/capture-reflect-practice npm run start:stdio
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
        "RECORDS_REPO_PATH": "/absolute/path/to/capture-reflect-practice",
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
- Add scheduled reflection and automated Bubble Breaker delivery.
