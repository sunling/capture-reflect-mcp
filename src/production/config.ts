function runtimeEnv(name: string): string | undefined {
  const netlify = (globalThis as typeof globalThis & {
    Netlify?: { env?: { get(key: string): string | undefined } };
  }).Netlify;
  return netlify?.env?.get(name) ?? process.env[name];
}

function required(name: string): string {
  const value = runtimeEnv(name)?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

function httpsUrl(name: string, value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return url.toString().replace(/\/$/, "");
}

export interface ProductionConfig {
  publicOrigin: string;
  resourceUrl: string;
  workosAuthkitDomain: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  githubClientId: string;
  githubClientSecret: string;
  githubAppSlug: string;
  tokenEncryptionKey: string;
  setupTokenSecret: string;
}

export function loadProductionConfig(): ProductionConfig {
  const publicOrigin = httpsUrl("MCP_PUBLIC_ORIGIN", required("MCP_PUBLIC_ORIGIN"));
  return {
    publicOrigin,
    resourceUrl: httpsUrl(
      "MCP_RESOURCE_URL",
      runtimeEnv("MCP_RESOURCE_URL")?.trim() || publicOrigin,
    ),
    workosAuthkitDomain: httpsUrl(
      "WORKOS_AUTHKIT_DOMAIN",
      required("WORKOS_AUTHKIT_DOMAIN"),
    ),
    supabaseUrl: httpsUrl("SUPABASE_URL", required("SUPABASE_URL")),
    supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    githubAppSlug: required("GITHUB_APP_SLUG"),
    tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),
    setupTokenSecret: required("SETUP_TOKEN_SECRET"),
  };
}
