import type { RecordsStore } from "../storage/records-store.js";
import { GitHubRecordsStore } from "../storage/github-records.js";
import type { ProductionConfig } from "./config.js";
import { ConnectionStore, type UserConnection } from "./connection-store.js";
import { refreshGitHubTokens } from "./github-auth.js";

export async function recordsStoreForUser(
  config: ProductionConfig,
  connections: ConnectionStore,
  userId: string,
): Promise<{ store: RecordsStore; connection: UserConnection }> {
  let connection = await connections.get(userId);
  if (!connection?.repository || !connection.installationId) {
    throw new Error("GitHub is not connected. Run get_github_setup_link first.");
  }
  const expiry = connection.accessTokenExpiresAt
    ? new Date(connection.accessTokenExpiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (expiry < Date.now() + 60_000) {
    if (!connection.refreshToken) throw new Error("GitHub authorization expired; reconnect GitHub.");
    const tokens = await refreshGitHubTokens(config, connection.refreshToken);
    await connections.updateTokens(userId, tokens);
    connection = { ...connection, ...tokens };
  }
  const repository = connection.repository;
  if (!repository) throw new Error("GitHub repository selection is missing.");
  return {
    connection,
    store: new GitHubRecordsStore({
      repository,
      token: connection.accessToken,
      branch: connection.branch,
    }),
  };
}

// Resolve GitHub credentials only for record operations, never for setup/tool discovery.
export function lazyRecordsStore(load: () => Promise<RecordsStore>): RecordsStore {
  let pending: Promise<RecordsStore> | undefined;
  const get = () => pending ??= load();
  return {
    captureJournal: async (input) => (await get()).captureJournal(input),
    captureNote: async (input) => (await get()).captureNote(input),
    saveReview: async (input) => (await get()).saveReview(input),
    getRecords: async (input) => (await get()).getRecords(input),
    searchRecords: async (input) => (await get()).searchRecords(input),
  };
}
