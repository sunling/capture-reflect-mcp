import { afterEach, expect, it, vi } from "vitest";
import { ConnectionStore } from "../src/production/connection-store.js";
import { decryptSecret } from "../src/production/crypto.js";
import type { ProductionConfig } from "../src/production/config.js";

afterEach(() => vi.unstubAllGlobals());

it("replaces authorization and clears old repository selection in the same upsert", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  const config = { supabaseUrl: "https://database.example.com", supabaseSecretKey: "test-secret", tokenEncryptionKey: "test-encryption-key" } as ProductionConfig;
  const store = new ConnectionStore(config);
  await store.saveAuthorization({ workosUserId: "user", githubUserId: 2, githubLogin: "new-user", accessToken: "new-access-token" });
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(String(url)).toContain("user_connections?on_conflict=workos_user_id");
  const payload = JSON.parse(options.body);
  expect(payload).toMatchObject({ workos_user_id: "user", github_user_id: 2, github_login: "new-user", installation_id: null, repository_full_name: null, branch: "main", refresh_token_encrypted: null });
  expect(payload.access_token_encrypted).not.toBe("new-access-token");
  expect(decryptSecret(payload.access_token_encrypted, config.tokenEncryptionKey)).toBe("new-access-token");
});

it("guards repository selection against an account switch during the request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("null", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const store = new ConnectionStore({ supabaseUrl: "https://database.example.com", supabaseSecretKey: "test-secret", tokenEncryptionKey: "key" } as ProductionConfig);
  await expect(store.selectRepository({ userId: "user", githubUserId: 1, installationId: 4, repository: "old/records", branch: "main", timeZone: "UTC" })).rejects.toThrow("GitHub account changed");
  const url = new URL(String(fetchMock.mock.calls[0]![0]));
  expect(url.searchParams.get("workos_user_id")).toBe("eq.user");
  expect(url.searchParams.get("github_user_id")).toBe("eq.1");
});
