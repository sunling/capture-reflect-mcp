import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses a stable local directory when RECORDS_REPO_PATH is unset", () => {
    expect(loadConfig({}).recordsRepoPath).toBe(
      path.join(os.homedir(), ".log-reflect", "records"),
    );
  });

  it("prefers an explicitly configured records path", () => {
    expect(loadConfig({ RECORDS_REPO_PATH: " ./my-records " }).recordsRepoPath).toBe(
      path.resolve("./my-records"),
    );
  });
});
