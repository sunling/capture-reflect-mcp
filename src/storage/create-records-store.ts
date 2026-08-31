import type { AppConfig } from "../config.js";
import { GitHubRecordsStore } from "./github-records.js";
import { LocalRecordsStore } from "./local-records.js";
import type { RecordsStore } from "./records-store.js";

export function createRecordsStore(config: AppConfig): RecordsStore {
  if (config.recordsStorage === "github") {
    return new GitHubRecordsStore({
      repository: config.githubRepository!,
      token: config.githubToken!,
      branch: config.githubBranch,
    });
  }
  return new LocalRecordsStore(config.recordsRepoPath);
}
