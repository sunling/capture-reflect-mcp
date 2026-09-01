import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ProductionConfig } from "./config.js";

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(domain: string): ReturnType<typeof createRemoteJWKSet> {
  let value = jwksByDomain.get(domain);
  if (!value) {
    value = createRemoteJWKSet(new URL(`${domain}/oauth2/jwks`));
    jwksByDomain.set(domain, value);
  }
  return value;
}

export function unauthorizedResponse(config: ProductionConfig, message: string): Response {
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", config.publicOrigin);
  return Response.json(
    { error: "unauthorized", error_description: message },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": [
          'Bearer error="unauthorized"',
          `error_description="${message.replaceAll('"', "'")}"`,
          `resource_metadata="${metadataUrl.toString()}"`,
        ].join(", "),
      },
    },
  );
}

export async function authenticateRequest(
  request: Request,
  config: ProductionConfig,
): Promise<{ userId: string; authInfo: AuthInfo } | Response> {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorizedResponse(config, "Authorization needed");

  try {
    const token = match[1]!;
    const { payload } = await jwtVerify(token, jwks(config.workosAuthkitDomain), {
      issuer: config.workosAuthkitDomain,
      audience: config.resourceUrl,
    });
    if (!payload.sub) return unauthorizedResponse(config, "Token subject is missing");
    const scope = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
    const clientId =
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.azp === "string"
          ? payload.azp
          : "mcp-client";
    return {
      userId: payload.sub,
      authInfo: {
        token,
        clientId,
        scopes: scope,
        ...(typeof payload.exp === "number" ? { expiresAt: payload.exp } : {}),
        resource: new URL(config.resourceUrl),
        extra: { userId: payload.sub },
      },
    };
  } catch {
    return unauthorizedResponse(config, "Invalid or expired access token");
  }
}
