import { afterEach, describe, expect, it, vi } from "vitest";
import { completeConnect, resolveGitHubUser } from "../src/production/workos-connect.js";
import { getVerifiedGitHubEmail } from "../src/production/github-auth.js";
import type { ProductionConfig } from "../src/production/config.js";
const config = { workosApiKey: "test-key", workosAuthkitDomain: "https://auth.example.com" } as ProductionConfig;
const user = { id: "user_existing", external_id: "github:42", email: "verified@example.com" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("WorkOS identity continuity", () => {
  it("preserves the existing WorkOS user ID after explicit migration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(user)); vi.stubGlobal("fetch", fetchMock);
    const result = await resolveGitHubUser(config, { userIdsForGitHub: async () => ["user_existing"] }, 42, "new-email@example.com");
    expect(result).toEqual({ userId: "user_existing", externalUserId: "github:42", email: "verified@example.com" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("creates a new identity only when neither mapping exists", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response(user)); vi.stubGlobal("fetch", fetchMock);
    expect((await resolveGitHubUser(config, { userIdsForGitHub: async () => [] }, 42, "verified@example.com")).userId).toBe("user_existing");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ email: "verified@example.com", email_verified: true, external_id: "github:42" });
  });

  it.each([undefined, { ...user, id: "different-user" }])("does not silently merge or replace a legacy mapping", async (found) => {
    const fetchMock = vi.fn().mockResolvedValue(response(found ?? {}, found ? 200 : 404)); vi.stubGlobal("fetch", fetchMock);
    await expect(resolveGitHubUser(config, { userIdsForGitHub: async () => ["user_existing"] }, 42, "verified@example.com")).rejects.toThrow("requires migration");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects ambiguous mappings before contacting WorkOS", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(resolveGitHubUser(config, { userIdsForGitHub: async () => ["one", "two"] }, 42, "verified@example.com")).rejects.toThrow("multiple existing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not merge identities by email when new-user creation conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({ secret: "upstream-sensitive-data" }, 422)); vi.stubGlobal("fetch", fetchMock);
    await expect(resolveGitHubUser(config, { userIdsForGitHub: async () => [] }, 42, "verified@example.com")).rejects.toThrow("WorkOS POST failed (422)");
  });
});

describe("WorkOS completion", () => {
  it("passes authenticated identity and context to completion and accepts only WorkOS's return URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ redirect_uri: "https://auth.example.com/oauth/authorize/complete?state=signed" })); vi.stubGlobal("fetch", fetchMock);
    expect(await completeConnect(config, { externalAuthId: "ext", userId: "user_existing", email: "verified@example.com" })).toContain("auth.example.com");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ external_auth_id: "ext", user: { id: "user_existing", email: "verified@example.com" } });
  });
  it("accepts a provider-supplied continuation path on the configured HTTPS origin", async () => {
    const redirect_uri = "https://auth.example.com/new-continuation?state=private-state";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ redirect_uri })));
    await expect(completeConnect(config, { externalAuthId: "ext", userId: "user_existing", email: "verified@example.com" })).resolves.toBe(redirect_uri);
  });
  it("reports mismatched origins without leaking state or authorization codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ redirect_uri: "https://other.authkit.app/complete?state=secret-state&code=secret-code" })));
    const error = await completeConnect(config, { externalAuthId: "ext", userId: "user_existing", email: "verified@example.com" }).catch((error: Error) => error);
    expect(String(error)).toContain("received https://other.authkit.app; expected https://auth.example.com");
    expect(String(error)).not.toContain("secret-state");
    expect(String(error)).not.toContain("secret-code");
  });
  it.each(["https://evil.example/oauth/authorize/complete", "https://auth.example.com.evil.example/complete", "https://user:pass@auth.example.com/oauth/authorize/complete", "http://auth.example.com/oauth/authorize/complete", "javascript:alert(1)", "not-a-url", ""])("rejects unexpected redirect %s", async (redirect_uri) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ redirect_uri })));
    await expect(completeConnect(config, { externalAuthId: "ext", userId: "user_existing", email: "verified@example.com" })).rejects.toThrow();
  });
});

it("uses a verified primary email, never an unverified profile address", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response([{ email: "unverified@example.com", primary: true, verified: false }])).mockResolvedValueOnce(response([{ email: "verified@example.com", primary: true, verified: true }]));
  vi.stubGlobal("fetch", fetchMock);
  await expect(getVerifiedGitHubEmail("token")).rejects.toThrow("verified primary email");
  await expect(getVerifiedGitHubEmail("token")).resolves.toBe("verified@example.com");
});
