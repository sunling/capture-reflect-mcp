import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(), save: vi.fn(), select: vi.fn(), exchange: vi.fn(), identity: vi.fn(), email: vi.fn(),
  installations: vi.fn(), repositories: vi.fn(), resolve: vi.fn(), complete: vi.fn(), initialize: vi.fn(),
  config: { publicOrigin: "https://api.example.com", resourceUrl: "https://api.example.com", workosAuthkitDomain: "https://auth.example.com", workosApiKey: "test", workosStandaloneEnabled: true, setupTokenSecret: "test-secret", githubClientId: "github-client", githubAppSlug: "capture-reflect" },
}));
vi.mock("../src/production/config.js", () => ({ loadProductionConfig: () => mocks.config }));
vi.mock("../src/production/connection-store.js", () => ({ ConnectionStore: class { get = mocks.get; saveAuthorization = mocks.save; selectRepository = mocks.select; } }));
vi.mock("../src/production/github-auth.js", async (original) => ({
  ...await original<typeof import("../src/production/github-auth.js")>(),
  exchangeGitHubCode: mocks.exchange, getGitHubIdentity: mocks.identity, getVerifiedGitHubEmail: mocks.email,
  listInstallations: mocks.installations, listInstallationRepositories: mocks.repositories,
}));
vi.mock("../src/production/workos-connect.js", () => ({ resolveGitHubUser: mocks.resolve, completeConnect: mocks.complete }));
vi.mock("../src/storage/github-records.js", () => ({ GitHubRecordsStore: class { initializeRepository = mocks.initialize; } }));
import login from "../netlify/functions/connect-login.js";
import setup from "../netlify/functions/github-setup.js";
import { verifySetupToken, verifyLoginState, createSetupToken } from "../src/production/setup-token.js";
import type { ProductionConfig } from "../src/production/config.js";
const config = mocks.config as ProductionConfig;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.workosStandaloneEnabled = true;
  mocks.exchange.mockResolvedValue({ accessToken: "github-secret" });
  mocks.identity.mockResolvedValue({ id: 42, login: "chosen-user" });
  mocks.email.mockResolvedValue("verified@example.com");
  mocks.resolve.mockResolvedValue({ userId: "user_existing", externalUserId: "github:42", email: "verified@example.com" });
  mocks.get.mockResolvedValue({ githubUserId: 42, githubLogin: "chosen-user", accessToken: "github-secret" });
  mocks.installations.mockResolvedValue([{ id: 1 }]);
  mocks.repositories.mockResolvedValue([{ full_name: "chosen-user/records", default_branch: "main" }]);
  mocks.complete.mockResolvedValue("https://auth.example.com/oauth/authorize/complete?state=workos-state");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function start() {
  const response = await login(new Request("https://api.example.com/auth/login?external_auth_id=ext_auth_test"));
  const location = new URL(response.headers.get("location")!);
  return { response, location, state: location.searchParams.get("state")! };
}
async function callback(state: string, cookieState = state) {
  return login(new Request(`https://api.example.com/auth/github/callback?state=${state}&code=code`, { headers: { cookie: `capture_reflect_login=${cookieState}` } }));
}

describe("Standalone connection flow", () => {
  it.each(["", "unrelated=present; ", "first=one; second=two; "])("selects GitHub and a repository with cookie prefix %j before returning control to WorkOS", async (cookiePrefix) => {
    const { response, location, state } = await start();
    expect(response.status).toBe(302);
    expect(location.searchParams.get("prompt")).toBe("select_account");
    expect(location.searchParams.get("redirect_uri")).toBe("https://api.example.com/auth/github/callback");
    expect(await verifyLoginState(config, state)).toBe("ext_auth_test");
    await expect(verifySetupToken(config, state)).rejects.toThrow();
    const authorized = await callback(state);
    expect(authorized.status).toBe(302);
    expect(mocks.exchange).toHaveBeenCalledWith(mocks.config, "code", "/auth/github/callback");
    expect(mocks.email).toHaveBeenCalledWith("github-secret");
    expect(mocks.save).toHaveBeenCalledWith({ workosUserId: "user_existing", githubUserId: 42, githubLogin: "chosen-user", accessToken: "github-secret" });
    const url = new URL(authorized.headers.get("location")!);
    const token = url.searchParams.get("token")!;
    expect(await verifySetupToken(config, token)).toBe("user_existing");
    const setupCookie = authorized.headers.get("set-cookie");
    expect(setupCookie).not.toContain("github-secret");
    expect(setupCookie).toContain(`capture_reflect_setup=${encodeURIComponent(token)}`);
    expect(setupCookie).not.toContain("capture_reflect_login=");
    const headers = { cookie: `${cookiePrefix}capture_reflect_setup=${token}; another=value` };
    const page = await setup(new Request(url, { headers }));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("/auth/login?external_auth_id=ext_auth_test");
    expect(mocks.complete).not.toHaveBeenCalled();
    const saved = await setup(new Request("https://api.example.com/setup/repository", { method: "POST", headers, body: new URLSearchParams({ token, github_user_id: "42", timezone: "UTC", repository: JSON.stringify([1, "chosen-user/records", "main"]) }) }));
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("https://auth.example.com/oauth/authorize/complete?state=workos-state");
    expect(mocks.complete).toHaveBeenCalledWith(config, { externalAuthId: "ext_auth_test", externalUserId: "github:42", email: "verified@example.com", githubUserId: 42 });
    expect(mocks.select.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]!);
  });

  it("rejects missing, mismatched and expired login state before exchanging credentials", async () => {
    expect((await login(new Request("https://api.example.com/auth/login"))).status).toBe(400);
    const { state } = await start();
    expect((await callback(state, "wrong")).status).toBe(400);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await callback(state)).status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("rejects a copied setup link without the login browser cookie", async () => {
    const { state } = await start();
    const authorized = await callback(state);
    const response = await setup(new Request(authorized.headers.get("location")!));
    expect(response.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each(["unrelated=present", "unrelated=present; capture_reflect_setup=wrong"])("rejects saving with missing or mismatched setup cookies: %s", async (cookie) => {
    const token = await createSetupToken(config, "user_existing", { externalAuthId: "ext_auth_test", externalUserId: "github:42", email: "verified@example.com", githubUserId: 42 });
    const response = await setup(new Request("https://api.example.com/setup/repository", {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams({ token, github_user_id: "42", repository: JSON.stringify([1, "chosen-user/records", "main"]), timezone: "UTC" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Connection setup must continue in the browser where login started.");
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("does not complete OAuth after repository persistence fails", async () => {
    const token = await createSetupToken(config, "user_existing", { externalAuthId: "ext_auth_test", externalUserId: "github:42", email: "verified@example.com", githubUserId: 42 });
    mocks.select.mockRejectedValue(new Error("Storage unavailable"));
    const response = await setup(new Request("https://api.example.com/setup/repository", { method: "POST", headers: { cookie: `capture_reflect_setup=${token}` }, body: new URLSearchParams({ token, github_user_id: "42", repository: JSON.stringify([1, "chosen-user/records", "main"]), timezone: "UTC" }) }));
    expect(response.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("leaves standalone login off until explicitly enabled", async () => {
    mocks.config.workosStandaloneEnabled = false;
    expect((await login(new Request("https://api.example.com/auth/login?external_auth_id=test"))).status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
