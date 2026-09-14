import type { Config } from "@netlify/functions";
import { brandPage, escapeHtml } from "./_shared/brand-page.js";
import { loadProductionConfig } from "../../src/production/config.js";
import { ConnectionStore } from "../../src/production/connection-store.js";
import { createLoginState, verifyLoginState, createSetupToken } from "../../src/production/setup-token.js";
import { githubAuthorizeUrl, exchangeGitHubCode, getGitHubIdentity, getVerifiedGitHubEmail } from "../../src/production/github-auth.js";
import { resolveGitHubUser } from "../../src/production/workos-connect.js";

const runtime = loadProductionConfig();
const connections = new ConnectionStore(runtime);
const callback = "/auth/github/callback";
const cookieName = "capture_reflect_login";
const cookie = (value: string, maxAge = 900) => `${cookieName}=${encodeURIComponent(value)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export default async (request: Request): Promise<Response> => {
  let response: Response;
  try {
    if (!runtime.workosStandaloneEnabled || !runtime.workosApiKey) throw new Error("Standalone login is not configured. Set WORKOS_API_KEY and WORKOS_STANDALONE_ENABLED before configuring the WorkOS Login URI.");
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
    if (url.pathname === "/auth/login") {
      const externalAuthId = url.searchParams.get("external_auth_id");
      if (!externalAuthId || externalAuthId.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(externalAuthId)) throw new Error("Start a new connection from your AI client. The login context is missing or invalid.");
      const state = await createLoginState(runtime, externalAuthId);
      // Never bypass account selection based on a prior browser or GitHub connection.
      response = new Response(null, { status: 302, headers: { location: githubAuthorizeUrl(runtime, state, callback), "set-cookie": cookie(state) } });
    } else if (url.pathname === callback) {
      const state = url.searchParams.get("state");
      const saved = request.headers.get("cookie")?.match(/(?:^|;\s*)capture_reflect_login=([^;]+)/)?.[1];
      if (!state || !saved || state !== decodeURIComponent(saved)) throw new Error("Login state did not match this browser. Start a new connection.");
      const externalAuthId = await verifyLoginState(runtime, state);
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.has("error")) throw new Error("GitHub authorization was not completed. Start a new connection to try again.");
      const tokens = await exchangeGitHubCode(runtime, code, callback);
      const identity = await getGitHubIdentity(tokens.accessToken);
      const email = await getVerifiedGitHubEmail(tokens.accessToken);
      const user = await resolveGitHubUser(runtime, connections, identity.id, email);
      await connections.saveAuthorization({ workosUserId: user.userId, githubUserId: identity.id, githubLogin: identity.login, ...tokens });
      const setup = await createSetupToken(runtime, user.userId, { externalAuthId, externalUserId: user.externalUserId, email: user.email, githubUserId: identity.id });
      const destination = new URL("/setup", runtime.publicOrigin);
      destination.searchParams.set("token", setup);
      destination.searchParams.set("repositories", "1");
      const headers = new Headers({ location: destination.toString() });
      headers.append("set-cookie", cookie("", 0));
      headers.append("set-cookie", `capture_reflect_setup=${encodeURIComponent(setup)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
      response = new Response(null, { status: 302, headers });
    } else {
      response = new Response("Not found", { status: 404 });
    }
  } catch (error) {
    response = brandPage({ title: "Connection could not be completed", status: 400, body: `<section class="setup-card"><h1>Connection could not be completed</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unexpected login error")}</p></section>` });
  }
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
};

export const config: Config = { path: ["/auth/login", "/auth/github/callback"] };
