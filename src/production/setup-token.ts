import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ProductionConfig } from "./config.js";

const SETUP_AUDIENCE = "capture-reflect-github-setup";

function secretKey(config: ProductionConfig): Uint8Array {
  return new TextEncoder().encode(config.setupTokenSecret);
}

export async function createSetupToken(
  config: ProductionConfig,
  userId: string,
  completion?: { externalAuthId: string; email: string; githubUserId: number },
): Promise<string> {
  return new SignJWT({ purpose: "github-setup", ...(completion ? { completion } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.resourceUrl)
    .setAudience(SETUP_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .setJti(randomUUID())
    .sign(secretKey(config));
}

export async function verifySetupToken(
  config: ProductionConfig,
  token: string,
): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey(config), {
    issuer: config.resourceUrl,
    audience: SETUP_AUDIENCE,
    algorithms: ["HS256"],
  });
  if (!payload.sub || payload.purpose !== "github-setup") {
    throw new Error("Invalid setup token.");
  }
  return payload.sub;
}

export async function createSetupUrl(
  config: ProductionConfig,
  userId: string,
): Promise<string> {
  const url = new URL("/setup", config.publicOrigin);
  url.searchParams.set("token", await createSetupToken(config, userId));
  return url.toString();
}

export async function setupCompletion(config: ProductionConfig, token: string) {
  const userId = await verifySetupToken(config, token);
  const { payload } = await jwtVerify(token, secretKey(config), {
    issuer: config.resourceUrl, audience: SETUP_AUDIENCE, algorithms: ["HS256"],
  });
  const value = payload.completion as Record<string, unknown> | undefined;
  if (!value) return undefined;
  if (typeof value.externalAuthId !== "string" || typeof value.email !== "string" ||
      typeof value.githubUserId !== "number") throw new Error("Invalid completion context.");
  // The signed setup token's subject is the same key used by user_connections.
  // Derive it here instead of carrying a second, potentially divergent ID.
  return { externalAuthId: value.externalAuthId, userId, email: value.email, githubUserId: value.githubUserId };
}

export async function createLoginState(config: ProductionConfig, externalAuthId: string): Promise<string> {
  return new SignJWT({ externalAuthId }).setProtectedHeader({ alg: "HS256" })
    .setIssuer(config.resourceUrl).setAudience("capture-reflect-login").setIssuedAt()
    .setExpirationTime("15m").setJti(randomUUID()).sign(secretKey(config));
}

export async function verifyLoginState(config: ProductionConfig, token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey(config), {
    issuer: config.resourceUrl, audience: "capture-reflect-login", algorithms: ["HS256"],
  });
  if (typeof payload.externalAuthId !== "string") throw new Error("Invalid login context.");
  return payload.externalAuthId;
}
