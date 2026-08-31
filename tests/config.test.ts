import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses a stable local directory when RECORDS_REPO_PATH is unset", () => {
    expect(loadConfig({}).recordsStorage).toBe("local");
    expect(loadConfig({}).recordsRepoPath).toBe(
      path.join(os.homedir(), ".log-reflect", "records"),
    );
  });

  it("prefers an explicitly configured records path", () => {
    expect(loadConfig({ RECORDS_REPO_PATH: " ./my-records " }).recordsRepoPath).toBe(
      path.resolve("./my-records"),
    );
  });

  it("loads GitHub storage settings", () => {
    const config = loadConfig({
      RECORDS_STORAGE: "github",
      RECORDS_GITHUB_REPOSITORY: "sunling/sunling-os",
      RECORDS_GITHUB_TOKEN: "secret",
      RECORDS_GITHUB_BRANCH: "records",
    });

    expect(config.recordsStorage).toBe("github");
    expect(config.githubRepository).toBe("sunling/sunling-os");
    expect(config.githubBranch).toBe("records");
  });

  it("requires GitHub repository and token for GitHub storage", () => {
    expect(() => loadConfig({ RECORDS_STORAGE: "github" })).toThrow(
      "RECORDS_GITHUB_REPOSITORY",
    );
    expect(() =>
      loadConfig({
        RECORDS_STORAGE: "github",
        RECORDS_GITHUB_REPOSITORY: "sunling/sunling-os",
      }),
    ).toThrow("RECORDS_GITHUB_TOKEN");
  });
});
