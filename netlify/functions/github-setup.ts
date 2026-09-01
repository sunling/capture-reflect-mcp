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

const runtime = loadProductionConfig();
const connections = new ConnectionStore(runtime);
const cookieName = "log_reflect_setup";

function html(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:17px/1.55 system-ui;max-width:720px;margin:8vh auto;padding:0 24px;color:#25231f}label{display:block;margin:18px 0 6px}select,input,button{font:inherit;padding:10px;max-width:100%}button{margin-top:22px;background:#395f45;color:white;border:0;border-radius:8px}</style><main><h1>${escapeHtml(title)}</h1>${body}</main></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
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
  return html("Choose your records repository", `<form method="post" action="/setup/repository"><input type="hidden" name="token" value="${escapeHtml(token)}"><label for="repository">Repository</label><select id="repository" name="repository" required>${options}</select><label for="timezone">Time zone</label><input id="timezone" name="timezone" value="UTC" placeholder="Asia/Macau" required><button type="submit">Save connection</button></form>`);
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
  await connections.selectRepository({
    userId,
    installationId,
    repository: repository.full_name,
    branch: repository.default_branch || branch,
    timeZone,
  });
  return html("Log & Reflect is connected", `<p>Records will be stored in <strong>${escapeHtml(repository.full_name)}</strong>. You can close this page and return to ChatGPT.</p>`);
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
