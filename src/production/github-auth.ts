import type { ProductionConfig } from "./config.js";

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

export interface GitHubIdentity { id: number; login: string }
export interface GitHubRepository { id: number; full_name: string; default_branch: string }

function future(seconds: unknown): string | undefined {
  return typeof seconds === "number"
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : undefined;
}

async function tokenRequest(
  config: ProductionConfig,
  body: URLSearchParams,
): Promise<GitHubTokens> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof value.access_token !== "string") {
    throw new Error(`GitHub authorization failed: ${String(value.error_description ?? value.error ?? response.status)}`);
  }
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(future(value.expires_in) ? { accessTokenExpiresAt: future(value.expires_in)! } : {}),
    ...(future(value.refresh_token_expires_in)
      ? { refreshTokenExpiresAt: future(value.refresh_token_expires_in)! }
      : {}),
  };
}

export function githubAuthorizeUrl(config: ProductionConfig, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", `${config.publicOrigin}/github/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeGitHubCode(config: ProductionConfig, code: string): Promise<GitHubTokens> {
  return tokenRequest(config, new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    code,
    redirect_uri: `${config.publicOrigin}/github/callback`,
  }));
}

export function refreshGitHubTokens(
  config: ProductionConfig,
  refreshToken: string,
): Promise<GitHubTokens> {
  return tokenRequest(config, new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "capture-reflect-mcp",
    },
  });
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export function getGitHubIdentity(token: string): Promise<GitHubIdentity> {
  return githubJson<GitHubIdentity>("/user", token);
}

export async function listInstallations(token: string): Promise<Array<{ id: number }>> {
  const value = await githubJson<{ installations: Array<{ id: number }> }>(
    "/user/installations?per_page=100",
    token,
  );
  return value.installations;
}

export async function listInstallationRepositories(
  token: string,
  installationId: number,
): Promise<GitHubRepository[]> {
  const value = await githubJson<{ repositories: GitHubRepository[] }>(
    `/user/installations/${installationId}/repositories?per_page=100`,
    token,
  );
  return value.repositories;
}
