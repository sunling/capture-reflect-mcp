import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitHubRecordsStore } from "../dist/src/storage/github-records.js";
import { createGitHubRequestTracker } from "../dist/src/production/github-request-observability.js";

// Fetch only the two test periods. All subsequent writes go to the temporary
// local fixture. Credentials stay in memory and never enter the HTTP child.
export async function loadGitHubReviewFixture(repository, root) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const metadata = JSON.parse(execFileSync("gh", ["api", `repos/${repository}`, "--jq", "{default_branch}"], {
    encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
  }));
  const token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
    encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const tracker = createGitHubRequestTracker(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.origin, "https://api.github.com");
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      assert.equal(method, "POST");
      assert.equal(url.pathname, "/graphql");
      assert.match(JSON.parse(init.body).query, /^\s*query\b/);
    }
    return fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
  });
  const store = new GitHubRecordsStore({ repository, token, branch: metadata.default_branch, fetch: tracker.fetch });
  const started = performance.now();
  const records = await store.getRecords({ from: "2026-09-01", to: "2026-09-14", types: ["journal", "note"] });
  const weekly = records.filter((record) => record.date >= "2026-09-08");
  const previous = records.filter((record) => record.date <= "2026-09-07");
  assert.ok(weekly.length > 0, "No real records in 2026-09-08 through 2026-09-14");
  assert.ok(previous.length > 0, "No comparison records in 2026-09-01 through 2026-09-07");
  for (const record of records) {
    assert.match(record.path, /^(journals|notes)\/.+\.md$/);
    assert.ok(!record.path.split("/").some((part) => !part || part === "." || part === ".."));
    assert.ok(!record.path.includes("\\"));
    const target = path.join(root, record.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, record.content, "utf8");
  }
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.byCategory.graphql_write, 0);
  assert.equal(snapshot.byCategory.contents_write, 0);
  console.log(JSON.stringify({
    source: repository, branch: metadata.default_branch, from: "2026-09-01", to: "2026-09-14",
    records: records.length, weekly: weekly.length, previous: previous.length,
    contentBytes: records.reduce((sum, record) => sum + Buffer.byteLength(record.content), 0),
    durationMs: Math.round(performance.now() - started), githubRequests: snapshot.total,
    byCategory: snapshot.byCategory,
  }));
  return { records, weekly, previous };
}
