import path from "node:path";

export interface AppConfig {
  recordsRepoPath: string;
  timeZone?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configuredPath = env.RECORDS_REPO_PATH?.trim();
  if (!configuredPath) {
    throw new Error(
      "RECORDS_REPO_PATH is required and must point to a log-reflect-practice repository.",
    );
  }

  const timeZone = env.RECORDS_TIME_ZONE?.trim();
  return {
    recordsRepoPath: path.resolve(configuredPath),
    ...(timeZone ? { timeZone } : {}),
  };
}

