import { describe, expect, it } from "vitest";
import type { ProductionConfig } from "../src/production/config.js";
import { decryptSecret, encryptSecret } from "../src/production/crypto.js";
import { createSetupToken, verifySetupToken } from "../src/production/setup-token.js";

const config: ProductionConfig = {
  publicOrigin: "https://api.example.com",
  resourceUrl: "https://api.example.com",
  workosAuthkitDomain: "https://auth.example.com",
  supabaseUrl: "https://database.example.com",
  supabaseSecretKey: "server-secret",
  githubClientId: "client-id",
  githubClientSecret: "client-secret",
  githubAppSlug: "log-reflect",
  tokenEncryptionKey: "encryption-secret-that-is-not-committed",
  setupTokenSecret: "setup-secret-that-is-not-committed",
};

describe("production credential protection", () => {
  it("encrypts stored credentials with authenticated encryption", () => {
    const encrypted = encryptSecret("github-token", config.tokenEncryptionKey);
    expect(encrypted).not.toContain("github-token");
    expect(decryptSecret(encrypted, config.tokenEncryptionKey)).toBe("github-token");
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}x`, config.tokenEncryptionKey)).toThrow();
  });

  it("issues setup tokens for only the intended resource and user", async () => {
    const token = await createSetupToken(config, "user_123");
    await expect(verifySetupToken(config, token)).resolves.toBe("user_123");
    await expect(
      verifySetupToken({ ...config, resourceUrl: "https://other.example.com" }, token),
    ).rejects.toThrow();
  });
});
