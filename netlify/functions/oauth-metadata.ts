import type { Config } from "@netlify/functions";
import { loadProductionConfig } from "../../src/production/config.js";

const runtime = loadProductionConfig();

export default async (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname;
  if (path === "/.well-known/oauth-protected-resource") {
    return Response.json({
      resource: runtime.resourceUrl,
      authorization_servers: [runtime.workosAuthkitDomain],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email"],
    }, { headers: { "cache-control": "public, max-age=300" } });
  }
  const upstream = await fetch(`${runtime.workosAuthkitDomain}/.well-known/oauth-authorization-server`);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "public, max-age=300" },
  });
};

export const config: Config = {
  path: ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"],
};
