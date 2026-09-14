import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), saveAuthorization: vi.fn(), selectRepository: vi.fn(),
  exchange: vi.fn(), identity: vi.fn(), installations: vi.fn(), repositories: vi.fn(),
  verify: vi.fn(), initialize: vi.fn(),
}));
vi.mock("../src/production/config.js", () => ({ loadProductionConfig: () => ({ publicOrigin: "https://api.example.com", workosAuthkitDomain: "https://auth.example.com", githubClientId: "client-id", githubAppSlug: "capture-reflect" }) }));
vi.mock("../src/production/connection-store.js", () => ({ ConnectionStore: class {
  get = mocks.get; saveAuthorization = mocks.saveAuthorization; selectRepository = mocks.selectRepository;
} }));
vi.mock("../src/production/setup-token.js", () => ({ verifySetupToken: mocks.verify, setupCompletion: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/production/github-auth.js", async (original) => ({
  ...await original<typeof import("../src/production/github-auth.js")>(),
  exchangeGitHubCode: mocks.exchange, getGitHubIdentity: mocks.identity,
  listInstallations: mocks.installations, listInstallationRepositories: mocks.repositories,
}));
vi.mock("../src/storage/github-records.js", () => ({ GitHubRecordsStore: class { initializeRepository = mocks.initialize; } }));
import handler from "../netlify/functions/github-setup.js";

const oldConnection = { githubUserId: 1, githubLogin: "old-user", accessToken: "old-token", repository: "old-user/records" };
const token = "valid-setup-token";
const request = (path: string) => new Request(`https://api.example.com${path}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue("workos-user");
  mocks.get.mockResolvedValue(oldConnection);
  mocks.installations.mockResolvedValue([{ id: 2 }]);
  mocks.repositories.mockResolvedValue([{ full_name: "new-user/records", default_branch: "main" }]);
});
afterEach(() => vi.restoreAllMocks());

describe("GitHub account switching", () => {
  it("shows the saved account and a switch option without needing its GitHub token to work", async () => {
    const response = await handler(request(`/setup?token=${token}`));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("old-user");
    expect(body).toContain("reauthorize=1");
    expect(mocks.installations).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("bypasses the saved connection and forces GitHub account selection without clearing it early", async () => {
    const response = await handler(request(`/setup?token=${token}&reauthorize=1`));
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://github.com");
    expect(target.searchParams.get("prompt")).toBe("select_account");
    expect(target.searchParams.get("state")).toBe(token);
    expect(target.searchParams.get("redirect_uri")).toBe("https://api.example.com/github/callback");
    expect(response.headers.get("set-cookie")).toContain(`capture_reflect_setup=${token}`);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.saveAuthorization).not.toHaveBeenCalled();
  });

  it("saves the identity GitHub returns and loads repositories with the new token", async () => {
    mocks.exchange.mockResolvedValue({ accessToken: "new-token" });
    mocks.identity.mockResolvedValue({ id: 2, login: "new-user" });
    mocks.get.mockResolvedValue({ githubUserId: 2, githubLogin: "new-user", accessToken: "new-token" });
    const response = await handler(new Request(`https://api.example.com/github/callback?state=${token}&code=code`, {
      headers: { cookie: `capture_reflect_setup=${token}` },
    }));
    expect(response.status).toBe(200);
    expect(mocks.saveAuthorization).toHaveBeenCalledWith({ workosUserId: "workos-user", githubUserId: 2, githubLogin: "new-user", accessToken: "new-token" });
    expect(mocks.installations).toHaveBeenCalledWith("new-token");
    const body = await response.text();
    expect(body).toContain('name="github_user_id" value="2"');
    expect(body).toContain("new-user/records");
  });

  it("rejects a callback from a different browser flow", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler(new Request(`https://api.example.com/github/callback?state=${token}&code=code`, {
      headers: { cookie: "capture_reflect_setup=different-state" },
    }));
    expect(response.status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.saveAuthorization).not.toHaveBeenCalled();
  });

  it("keeps the saved connection on cancellation and rejects expired setup links", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cancelled = await handler(new Request(`https://api.example.com/github/callback?state=${token}&error=access_denied`, {
      headers: { cookie: `capture_reflect_setup=${token}` },
    }));
    expect(cancelled.status).toBe(400);
    expect(mocks.saveAuthorization).not.toHaveBeenCalled();
    mocks.verify.mockRejectedValue(new Error("expired"));
    expect((await handler(request(`/setup?token=${token}&reauthorize=1`))).status).toBe(400);
  });

  it("connects a repository using the newly authorized account", async () => {
    mocks.get.mockResolvedValue({ githubUserId: 2, githubLogin: "new-user", accessToken: "new-token" });
    const response = await handler(new Request("https://api.example.com/setup/repository", {
      method: "POST", body: new URLSearchParams({ token, github_user_id: "2", repository: JSON.stringify([2, "new-user/records", "main"]), timezone: "Asia/Tokyo" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.repositories).toHaveBeenCalledWith("new-token", 2);
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(mocks.selectRepository).toHaveBeenCalledWith({ userId: "workos-user", githubUserId: 2, installationId: 2, repository: "new-user/records", branch: "main", timeZone: "Asia/Tokyo" });
  });

  it("rejects a repository form left open before switching accounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.get.mockResolvedValue({ ...oldConnection, githubUserId: 2 });
    const response = await handler(new Request("https://api.example.com/setup/repository", {
      method: "POST", body: new URLSearchParams({ token, github_user_id: "1", repository: JSON.stringify([2, "old-user/records", "main"]), timezone: "UTC" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.selectRepository).not.toHaveBeenCalled();
  });
});
