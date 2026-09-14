import type { ProductionConfig } from "./config.js";
import type { ConnectionStore } from "./connection-store.js";

interface WorkOSUser { id: string; external_id?: string | null; email: string }

async function workos<T>(config: ProductionConfig, path: string, method = "GET", body?: unknown): Promise<T | undefined> {
  if (!config.workosApiKey) throw new Error("Standalone login requires WORKOS_API_KEY on the server.");
  const response = await fetch(`https://api.workos.com${path}`, {
    method,
    headers: { authorization: `Bearer ${config.workosApiKey}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 404 && method === "GET") return undefined;
  // Do not expose upstream response bodies, which may contain credentials or user data.
  if (!response.ok) throw new Error(`WorkOS ${method} failed (${response.status}). Check the server configuration and identity migration before retrying.`);
  return response.json() as Promise<T>;
}

export async function resolveGitHubUser(
  config: ProductionConfig,
  connections: Pick<ConnectionStore, "userIdsForGitHub">,
  githubUserId: number,
  verifiedEmail: string,
): Promise<{ userId: string; externalUserId: string; email: string }> {
  const externalUserId = `github:${githubUserId}`;
  const legacy = await connections.userIdsForGitHub(githubUserId);
  if (legacy.length > 1) throw new Error("This GitHub account has multiple existing user mappings. An administrator must resolve them before standalone login.");
  let user = await workos<WorkOSUser>(config, `/user_management/users/external_id/${encodeURIComponent(externalUserId)}`);
  if (legacy.length && (!user || user.id !== legacy[0])) {
    throw new Error(`Existing account requires migration: set its WorkOS external ID to ${externalUserId} after verifying the existing user mapping. No accounts were merged.`);
  }
  if (!user) {
    // A conflicting email must fail rather than silently attaching a different identity.
    user = await workos<WorkOSUser>(config, "/user_management/users", "POST", {
      email: verifiedEmail, email_verified: true, external_id: externalUserId,
    });
  }
  if (!user?.id || !user.email || user.external_id !== externalUserId) throw new Error("WorkOS returned an invalid identity mapping.");
  return { userId: user.id, externalUserId, email: user.email };
}

export async function completeConnect(
  config: ProductionConfig,
  input: { externalAuthId: string; externalUserId: string; email: string },
): Promise<string> {
  const result = await workos<{ redirect_uri: string }>(config, "/authkit/oauth2/complete", "POST", {
    external_auth_id: input.externalAuthId,
    user: { id: input.externalUserId, email: input.email },
  });
  const url = new URL(result?.redirect_uri ?? "");
  if (url.origin !== new URL(config.workosAuthkitDomain).origin || url.username || url.password ||
      !["/oauth/authorize/complete", "/oauth2/authorize/complete"].includes(url.pathname)) {
    throw new Error("WorkOS returned an unexpected completion URL.");
  }
  return url.toString();
}
