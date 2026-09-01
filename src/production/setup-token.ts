import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ProductionConfig } from "./config.js";

const SETUP_AUDIENCE = "log-reflect-github-setup";

function secretKey(config: ProductionConfig): Uint8Array {
  return new TextEncoder().encode(config.setupTokenSecret);
}

export async function createSetupToken(
  config: ProductionConfig,
  userId: string,
): Promise<string> {
  return new SignJWT({ purpose: "github-setup" })
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
