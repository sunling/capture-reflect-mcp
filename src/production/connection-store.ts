import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProductionConfig } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export interface UserConnection {
  workosUserId: string;
  githubUserId: number;
  githubLogin: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  installationId?: number;
  repository?: string;
  branch: string;
  timeZone: string;
}

interface ConnectionRow {
  workos_user_id: string;
  github_user_id: number;
  github_login: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  installation_id: number | null;
  repository_full_name: string | null;
  branch: string;
  time_zone: string;
}

export class ConnectionStore {
  readonly #db: SupabaseClient;
  readonly #encryptionKey: string;

  constructor(config: ProductionConfig) {
    this.#encryptionKey = config.tokenEncryptionKey;
    this.#db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async get(userId: string): Promise<UserConnection | undefined> {
    const { data, error } = await this.#db
      .from("user_connections")
      .select("*")
      .eq("workos_user_id", userId)
      .maybeSingle<ConnectionRow>();
    if (error) throw new Error(`Unable to read account connection: ${error.message}`);
    return data ? this.#fromRow(data) : undefined;
  }

  async saveAuthorization(input: Omit<UserConnection, "branch" | "timeZone">): Promise<void> {
    const { error } = await this.#db.from("user_connections").upsert(
      {
        workos_user_id: input.workosUserId,
        github_user_id: input.githubUserId,
        github_login: input.githubLogin,
        access_token_encrypted: encryptSecret(input.accessToken, this.#encryptionKey),
        refresh_token_encrypted: input.refreshToken
          ? encryptSecret(input.refreshToken, this.#encryptionKey)
          : null,
        access_token_expires_at: input.accessTokenExpiresAt ?? null,
        refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workos_user_id" },
    );
    if (error) throw new Error(`Unable to save GitHub authorization: ${error.message}`);
  }

  async selectRepository(input: {
    userId: string;
    installationId: number;
    repository: string;
    branch: string;
    timeZone: string;
  }): Promise<void> {
    const { error } = await this.#db
      .from("user_connections")
      .update({
        installation_id: input.installationId,
        repository_full_name: input.repository,
        branch: input.branch,
        time_zone: input.timeZone,
        updated_at: new Date().toISOString(),
      })
      .eq("workos_user_id", input.userId);
    if (error) throw new Error(`Unable to save repository selection: ${error.message}`);
  }

  async updateTokens(userId: string, input: {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
  }): Promise<void> {
    const { error } = await this.#db
      .from("user_connections")
      .update({
        access_token_encrypted: encryptSecret(input.accessToken, this.#encryptionKey),
        refresh_token_encrypted: input.refreshToken
          ? encryptSecret(input.refreshToken, this.#encryptionKey)
          : null,
        access_token_expires_at: input.accessTokenExpiresAt ?? null,
        refresh_token_expires_at: input.refreshTokenExpiresAt ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("workos_user_id", userId);
    if (error) throw new Error(`Unable to refresh GitHub authorization: ${error.message}`);
  }

  #fromRow(row: ConnectionRow): UserConnection {
    return {
      workosUserId: row.workos_user_id,
      githubUserId: row.github_user_id,
      githubLogin: row.github_login,
      accessToken: decryptSecret(row.access_token_encrypted, this.#encryptionKey),
      ...(row.refresh_token_encrypted
        ? { refreshToken: decryptSecret(row.refresh_token_encrypted, this.#encryptionKey) }
        : {}),
      ...(row.access_token_expires_at ? { accessTokenExpiresAt: row.access_token_expires_at } : {}),
      ...(row.refresh_token_expires_at ? { refreshTokenExpiresAt: row.refresh_token_expires_at } : {}),
      ...(row.installation_id ? { installationId: row.installation_id } : {}),
      ...(row.repository_full_name ? { repository: row.repository_full_name } : {}),
      branch: row.branch || "main",
      timeZone: row.time_zone || "UTC",
    };
  }
}
