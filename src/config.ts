import os from "node:os";
import path from "node:path";

export interface AppConfig {
  recordsStorage: "local" | "github";
  recordsRepoPath: string;
  githubRepository?: string;
  githubToken?: string;
  githubBranch: string;
  timeZone?: string;
}

export interface HttpConfig extends AppConfig {
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configuredStorage = env.RECORDS_STORAGE?.trim().toLowerCase() || "local";
  if (configuredStorage !== "local" && configuredStorage !== "github") {
    throw new Error("RECORDS_STORAGE must be either local or github.");
  }

  const configuredPath = env.RECORDS_REPO_PATH?.trim();
  const recordsRepoPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(os.homedir(), ".log-reflect", "records");

  const timeZone = env.RECORDS_TIME_ZONE?.trim();
  const githubRepository = env.RECORDS_GITHUB_REPOSITORY?.trim();
  const githubToken = env.RECORDS_GITHUB_TOKEN?.trim();
  const githubBranch = env.RECORDS_GITHUB_BRANCH?.trim() || "main";

  if (configuredStorage === "github" && !githubRepository) {
    throw new Error("RECORDS_GITHUB_REPOSITORY is required when RECORDS_STORAGE=github.");
  }
  if (configuredStorage === "github" && !githubToken) {
    throw new Error("RECORDS_GITHUB_TOKEN is required when RECORDS_STORAGE=github.");
  }

  return {
    recordsStorage: configuredStorage,
    recordsRepoPath,
    githubBranch,
    ...(githubRepository ? { githubRepository } : {}),
    ...(githubToken ? { githubToken } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const config = loadConfig(env);
  const configuredPort = env.MCP_PORT?.trim();
  const port = configuredPort ? Number(configuredPort) : 3000;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535.");
  }

  return {
    ...config,
    host: env.MCP_HOST?.trim() || "127.0.0.1",
    port,
  };
}
