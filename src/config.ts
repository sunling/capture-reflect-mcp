import os from "node:os";
import path from "node:path";

export interface AppConfig {
  recordsRepoPath: string;
  timeZone?: string;
}

export interface HttpConfig extends AppConfig {
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configuredPath = env.RECORDS_REPO_PATH?.trim();
  const recordsRepoPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(os.homedir(), ".log-reflect", "records");

  const timeZone = env.RECORDS_TIME_ZONE?.trim();
  return {
    recordsRepoPath,
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
