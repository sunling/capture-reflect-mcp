import type { AppConfig } from "../config.js";
import { GitHubRecordsStore } from "./github-records.js";
import { LocalRecordsStore } from "./local-records.js";
import { withNoteEditing } from "./note-editing.js";
import type { RecordsStore } from "./records-store.js";

export function createRecordsStore(config: AppConfig): RecordsStore {
  if (config.recordsStorage === "github") {
    const options = {
      kind: "github" as const,
      repository: config.githubRepository!,
      token: config.githubToken!,
      branch: config.githubBranch,
    };
    return withNoteEditing(new GitHubRecordsStore(options), options);
  }
  return withNoteEditing(new LocalRecordsStore(config.recordsRepoPath), {
    kind: "local", root: config.recordsRepoPath,
  });
}
