import type { Config } from "@netlify/functions";
import { loadProductionConfig } from "../../src/production/config.js";
import { ConnectionStore } from "../../src/production/connection-store.js";
import {
  exchangeGitHubCode,
  getGitHubIdentity,
  githubAuthorizeUrl,
  listInstallationRepositories,
  listInstallations,
} from "../../src/production/github-auth.js";
import { verifySetupToken } from "../../src/production/setup-token.js";
import { GitHubRecordsStore } from "../../src/storage/github-records.js";

const runtime = loadProductionConfig();
const connections = new ConnectionStore(runtime);
const cookieName = "log_reflect_setup";

function html(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Log & Reflect</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f6f2;
      --card: #ffffff;
      --text: #1f211d;
      --muted: #6e716a;
      --line: #e5e4dd;
      --accent: #365b43;
      --accent-hover: #294a35;
      --soft: #edf3ee;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell {
      width: min(100% - 32px, 680px);
      margin: 0 auto;
      padding: 56px 0 72px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .mark {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: var(--accent);
      color: white;
      font-size: 17px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 14px 40px rgba(31,33,29,.05);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 9px;
      border-radius: 999px;
      background: var(--soft);
      color: var(--accent);
      font-size: 13px;
      font-weight: 650;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 5vw, 38px);
      line-height: 1.15;
      letter-spacing: -0.035em;
    }
    .lede {
      margin: 10px 0 26px;
      color: var(--muted);
      max-width: 560px;
    }
    .field { margin-top: 20px; }
    label {
      display: block;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: 650;
    }
    .hint {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    select, input {
      width: 100%;
      min-height: 46px;
      border: 1px solid #d7d8d2;
      border-radius: 10px;
      background: white;
      color: var(--text);
      padding: 10px 12px;
      font: inherit;
      outline: none;
    }
    select:focus, input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(54,91,67,.12);
    }
    button {
      width: 100%;
      min-height: 48px;
      margin-top: 26px;
      border: 0;
      border-radius: 11px;
      background: var(--accent);
      color: white;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    button:hover { background: var(--accent-hover); }
    .footer {
      margin-top: 18px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }
    .footer a { color: inherit; }
    .success {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      margin-bottom: 18px;
      background: var(--soft);
      color: var(--accent);
      font-size: 24px;
      font-weight: 700;
    }
    .repo {
      display: inline-block;
      margin-top: 4px;
      font-weight: 650;
      word-break: break-word;
    }
    @media (max-width: 520px) {
      .shell { padding-top: 28px; }
      .card { padding: 22px; border-radius: 15px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="brand"><span class="mark">↺</span><span>Log &amp; Reflect</span></div>
    <main class="card">
      ${body}
    </main>
    <div class="footer"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></div>
  </div>
</body>
</html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function setupCookie(token: string): string {
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`;
}

function cookieToken(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

async function tokenAndUser(request: Request): Promise<{ token: string; userId: string }> {
  const url = new URL(request.url);
  const token = url.searchParams.get("state") ?? url.searchParams.get("token") ?? cookieToken(request);
  if (!token) throw new Error("The setup link is missing or expired. Request a new link in ChatGPT.");
  return { token, userId: await verifySetupToken(runtime, token) };
}

async function repositoryPage(userId: string, token: string): Promise<Response> {
  const connection = await connections.get(userId);
  if (!connection) throw new Error("GitHub authorization was not found. Start setup again.");
  const installations = await listInstallations(connection.accessToken);
  if (installations.length === 0) {
    const install = new URL(`https://github.com/apps/${runtime.githubAppSlug}/installations/new`);
    install.searchParams.set("state", token);
    return Response.redirect(install.toString(), 302);
  }
  const repositories = (await Promise.all(installations.map(async ({ id }) =>
    (await listInstallationRepositories(connection.accessToken, id)).map((repository) => ({
      ...repository, installationId: id,
    })),
  ))).flat();
  if (repositories.length === 0) {
    return html("No repository selected", `<p>Edit the GitHub App installation and grant access to at least one repository, then request a new setup link.</p>`, 400);
  }
  const options = repositories.map((repository) => {
    const value = JSON.stringify([repository.installationId, repository.full_name, repository.default_branch]);
    return `<option value="${escapeHtml(value)}">${escapeHtml(repository.full_name)}</option>`;
  }).join("");
  return html("Connect your records", `
    <div class="eyebrow">✓ GitHub authorized</div>
    <h1>Choose where your records live</h1>
    <p class="lede">Log &amp; Reflect writes your journals and notes directly to a GitHub repository you control.</p>
    <form method="post" action="/setup/repository">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="field">
        <label for="repository">Records repository</label>
        <select id="repository" name="repository" required>${options}</select>
        <p class="hint">Only repositories granted to the Log &amp; Reflect GitHub App appear here.</p>
      </div>
      <div class="field">
        <label for="timezone">Time zone</label>
        <input id="timezone" name="timezone" value="UTC" placeholder="America/Los_Angeles" autocomplete="off" required>
        <p class="hint">Used to decide which date your journals and notes belong to.</p>
      </div>
      <button type="submit">Save &amp; connect</button>
    </form>
    <script>
      (() => {
        const input = document.getElementById("timezone");
        if (!(input instanceof HTMLInputElement)) return;
        try {
          const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (detected) input.value = detected;
        } catch {}
      })();
    </script>
  `);
}

async function saveRepository(request: Request): Promise<Response> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const userId = await verifySetupToken(runtime, token);
  const selected = JSON.parse(String(form.get("repository") ?? "")) as unknown;
  if (!Array.isArray(selected) || selected.length !== 3) throw new Error("Invalid repository selection.");
  const [installationId, repositoryName, branch] = selected;
  if (typeof installationId !== "number" || typeof repositoryName !== "string" || typeof branch !== "string") {
    throw new Error("Invalid repository selection.");
  }
  const timeZone = String(form.get("timezone") ?? "UTC").trim();
  new Intl.DateTimeFormat("en", { timeZone }).format();
  const connection = await connections.get(userId);
  if (!connection) throw new Error("GitHub authorization was not found.");
  const installations = await listInstallations(connection.accessToken);
  if (!installations.some(({ id }) => id === installationId)) throw new Error("GitHub installation is not authorized.");
  const repositories = await listInstallationRepositories(connection.accessToken, installationId);
  const repository = repositories.find(({ full_name }) => full_name === repositoryName);
  if (!repository) throw new Error("Repository is not accessible to this GitHub App installation.");
  const selectedBranch = repository.default_branch || branch || "main";
  const records = new GitHubRecordsStore({
    repository: repository.full_name,
    token: connection.accessToken,
    branch: selectedBranch,
  });
  await records.initializeRepository();
  await connections.selectRepository({
    userId,
    installationId,
    repository: repository.full_name,
    branch: selectedBranch,
    timeZone,
  });
  return html("Connected", `
    <div class="success">✓</div>
    <div class="eyebrow">Connection saved</div>
    <h1>You're all set</h1>
    <p class="lede">Your records will be stored in <span class="repo">${escapeHtml(repository.full_name)}</span>.</p>
    <p class="hint">You can close this page and return to ChatGPT. Log &amp; Reflect will use your selected repository and time zone from now on.</p>
  `);
}

export default async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/setup" && request.method === "GET") {
      const { token } = await tokenAndUser(request);
      return new Response(null, { status: 302, headers: { location: githubAuthorizeUrl(runtime, token), "set-cookie": setupCookie(token) } });
    }
    if (url.pathname === "/github/callback" && request.method === "GET") {
      const { token, userId } = await tokenAndUser(request);
      const code = url.searchParams.get("code");
      if (!code) throw new Error("GitHub did not return an authorization code.");
      const tokens = await exchangeGitHubCode(runtime, code);
      const identity = await getGitHubIdentity(tokens.accessToken);
      await connections.saveAuthorization({
        workosUserId: userId,
        githubUserId: identity.id,
        githubLogin: identity.login,
        ...tokens,
      });
      return repositoryPage(userId, token);
    }
    if (url.pathname === "/github/installed" && request.method === "GET") {
      const { token, userId } = await tokenAndUser(request);
      return repositoryPage(userId, token);
    }
    if (url.pathname === "/setup/repository" && request.method === "POST") {
      return saveRepository(request);
    }
    return html("Not found", "<p>This setup page does not exist.</p>", 404);
  } catch (error) {
    console.error(error);
    return html("Setup could not be completed", `<p>${escapeHtml(error instanceof Error ? error.message : "Unexpected setup error")}</p>`, 400);
  }
};

export const config: Config = {
  path: ["/setup", "/github/callback", "/github/installed", "/setup/repository"],
};
