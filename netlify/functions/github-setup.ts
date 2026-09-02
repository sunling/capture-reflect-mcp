import type { Config } from "@netlify/functions";
import { brandPage, escapeHtml } from "./_shared/brand-page.js";
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
  return brandPage({
    title,
    status,
    body: `<section class="setup-card">${body}</section>`,
  });
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
    <p class="lede">Capture &amp; Reflect writes your journals and notes directly to a GitHub repository you control.</p>
    <form method="post" action="/setup/repository">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <div class="field">
        <label for="repository">Records repository</label>
        <select id="repository" name="repository" required>${options}</select>
        <p class="hint">Only repositories granted to the Capture &amp; Reflect GitHub App appear here.</p>
      </div>
      <input type="hidden" id="timezone" name="timezone" value="UTC">
      <div class="field">
        <label>Time zone</label>
        <div class="timezone-display" id="timezone-display">UTC · detected automatically</div>
        <p class="hint">Used to decide which date your journals and notes belong to.</p>
      </div>
      <button type="submit">Save &amp; connect</button>
      <div class="privacy-note"><span>●</span><div>Your writing and images go directly to the GitHub repository you choose. Capture &amp; Reflect stores only the encrypted connection details needed to access it.</div></div>
    </form>
    <script>
      (() => {
        const input = document.getElementById("timezone");
        const display = document.getElementById("timezone-display");
        if (!(input instanceof HTMLInputElement)) return;
        try {
          const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (detected) {
            input.value = detected;
            if (display) display.textContent = detected + " · detected automatically";
          }
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
    <p class="hint">You can close this page and return to ChatGPT. Capture &amp; Reflect will use your selected repository and time zone from now on.</p>
    <div class="privacy-note"><span>●</span><div>Your repository is ready with journals, notes, and reviews folders.</div></div>
  `);
}

export default async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/setup" && request.method === "GET") {
      const { token, userId } = await tokenAndUser(request);
      const connection = await connections.get(userId);
      if (connection) {
        const response = await repositoryPage(userId, token);
        const headers = new Headers(response.headers);
        headers.append("set-cookie", setupCookie(token));
        return new Response(response.body, { status: response.status, headers });
      }
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
