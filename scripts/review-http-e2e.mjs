import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Exercise the built HTTP entrypoint in a separate process, without loading .env
// or touching the user's records. Requests use MCP JSON-RPC over real localhost HTTP.
const repo = fileURLToPath(new URL("../", import.meta.url));
const timings = [];
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--github"), "Usage: review-http-e2e.mjs [--github owner/repo]");
const githubRepository = args[1];
const root = await mkdtemp(path.join(tmpdir(), "review-http-e2e-"));
let child;
let exited;
let serverOutput = "";

try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(repo, "dist/src/http.js")], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      RECORDS_STORAGE: "local", RECORDS_REPO_PATH: root, RECORDS_TIME_ZONE: "UTC",
      MCP_HOST: "127.0.0.1", MCP_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  exited = new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", (error) => { serverOutput += error.message; resolve(); });
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { serverOutput += chunk.toString(); });
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`HTTP server exited: ${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).server === "capture-reflect-mcp") {
        ready = true;
        break;
      }
    } catch { /* Wait for the child process to listen. */ }
    await delay(50);
  }
  assert.ok(ready, `HTTP server did not become ready: ${serverOutput}`);

  let nextId = 0;
  let protocolVersion = "2025-03-26";
  let sessionId;
  async function rpc(method, params, label = method, notification = false) {
    const id = notification ? undefined : ++nextId;
    const started = performance.now();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        "mcp-protocol-version": protocolVersion,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const text = await response.text();
    assert.ok(response.ok, `${label}: HTTP ${response.status}: ${text}`);
    if (notification) return;
    assert.equal(response.status, 200, `${label}: expected HTTP 200, including tool errors`);
    const messages = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n\r?\n/).flatMap((event) => {
          const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart()).join("\n");
          return data ? [JSON.parse(data)] : [];
        })
      : [JSON.parse(text)];
    const message = messages.find((entry) => entry.id === id);
    assert.ok(message, `${label}: missing JSON-RPC response`);
    assert.equal(message.error, undefined, `${label}: ${JSON.stringify(message.error)}`);
    timings.push({ step: label, http: response.status, toolError: message.result.isError === true,
      ms: Math.round(performance.now() - started) });
    return message.result;
  }
  const initialized = await rpc("initialize", {
    protocolVersion, capabilities: {}, clientInfo: { name: "review-http-e2e", version: "1.0.0" },
  });
  protocolVersion = initialized.protocolVersion;
  await rpc("notifications/initialized", {}, undefined, true);
  const listing = await rpc("tools/list", {});
  assert.ok(listing.tools.some((tool) => tool.name === "save_review"));
  const call = (name, args, label = name) => rpc("tools/call", { name, arguments: args }, label);
  async function successful(name, args, label) {
    const result = await call(name, args, label);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  }

  const beforeDefault = new Date().toISOString().slice(0, 10);
  const defaultRange = await successful("get_records_by_date_range", {}, "default seven-day range");
  const afterDefault = new Date().toISOString().slice(0, 10);
  assert.ok([beforeDefault, afterDefault].includes(defaultRange.to));
  assert.equal(defaultRange.timeZone, "UTC");
  assert.equal(Date.parse(defaultRange.to) - Date.parse(defaultRange.from), 6 * 86_400_000);

  let expectedCurrentPaths;
  let expectedPreviousPaths;
  let fixture;
  if (githubRepository) {
    const { loadGitHubReviewFixture } = await import("./github-review-fixture.mjs");
    fixture = await loadGitHubReviewFixture(githubRepository, root);
    expectedCurrentPaths = fixture.weekly.map((record) => record.path);
    expectedPreviousPaths = fixture.previous.map((record) => record.path);
  } else {
    const earlier = await successful("capture_note", {
      date: "2026-09-07", title: "上周", keyword: "上周", originalNote: "上周的比较材料。",
    }, "capture earlier note");
    const current = await successful("capture_note", {
      date: "2026-09-10", title: "本周", keyword: "本周", originalNote: "散步后更容易专注。",
    }, "capture current note");
    const journal = await successful("capture_journal", {
      date: "2026-09-14", title: "星期日", keyword: "星期日", content: "今天在公园散步。",
    }, "capture current journal");
    expectedCurrentPaths = [current.path, journal.path];
    expectedPreviousPaths = [earlier.path];
  }
  const weekly = await successful("get_records_by_date_range", {
    from: "2026-09-08", to: "2026-09-14", types: ["journal", "note"],
  }, "read current week");
  const previous = await successful("get_records_by_date_range", {
    from: "2026-09-01", to: "2026-09-07", types: ["journal", "note"],
  }, "read previous week");
  assert.deepEqual(weekly.records.map((record) => record.path).sort(), expectedCurrentPaths.sort());
  assert.deepEqual(previous.records.map((record) => record.path).sort(), expectedPreviousPaths.sort());
  if (fixture) {
    for (const record of [...weekly.records, ...previous.records]) {
      assert.equal(record.content, fixture.records.find((source) => source.path === record.path).content);
    }
  }
  const review = {
    date: "2026-09-15", from: "2026-09-08", to: "2026-09-14", title: "每周回顾", keyword: "weekly",
    content: fixture
      ? `## 本地端到端测试\n读取 ${weekly.records.length} 条真实记录，仅验证存储与来源链接，不作个人内容解读。\n\n## 来源\n${weekly.records.map((record) => `- ${record.date}: ${record.path}`).join("\n")}`
      : "## 本周记录\n记录了两次散步。\n\n## AI 解读\n证据有限，暂不能判断稳定趋势。\n\n## 问题\n下周散步后是否也更容易专注？",
    sourcePaths: [...weekly.records, ...previous.records].map((record) => record.path),
  };
  const failed = await call("save_review", review, "save with mixed ranges (expected error)");
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /REVIEW_SOURCES_NOT_IN_RANGE/);
  for (const source of expectedPreviousPaths) assert.ok(failed.content[0].text.includes(source));
  console.log(fixture ? `Expected tool error: REVIEW_SOURCES_NOT_IN_RANGE (${expectedPreviousPaths.length} historical paths; names omitted)` : `Expected tool error: ${failed.content[0].text}`);
  const readReviews = () => successful("get_records_by_date_range", {
    from: review.date, to: review.date, types: ["review"],
  }, "read saved reviews");
  assert.deepEqual((await readReviews()).records, []);

  const badLink = await call("save_review", {
    ...review, sourcePaths: [`../../../${expectedCurrentPaths[0]}`],
  }, "save with Markdown path (expected error)");
  assert.equal(badLink.isError, true);
  assert.match(badLink.content[0].text, /REVIEW_SOURCE_PATH_INVALID/);
  assert.deepEqual((await readReviews()).records, []);

  const corrected = { ...review, sourcePaths: weekly.records.map((record) => record.path) };
  const saved = await successful("save_review", corrected, "save corrected review");
  assert.equal(saved.action, "created");
  assert.equal(saved.path, "reviews/2026/202609/20260908-20260914-weekly.md");
  const readBack = (await readReviews()).records;
  assert.equal(readBack.length, 1);
  assert.equal(readBack[0].path, saved.path);
  assert.ok(readBack[0].content.includes(review.content));
  for (const source of corrected.sourcePaths) {
    assert.ok(readBack[0].content.includes(source));
    assert.ok(readBack[0].content.includes(`../../../${source.split("/").map(encodeURIComponent).join("/")}`));
  }
  assert.equal(await readFile(path.join(root, saved.path), "utf8"), readBack[0].content);
  const duplicate = await call("save_review", { ...corrected, content: "replacement" }, "overwrite attempt (expected error)");
  assert.equal(duplicate.isError, true);
  assert.equal(await readFile(path.join(root, saved.path), "utf8"), readBack[0].content);
  assert.equal((await readReviews()).records.length, 1);
  const defaults = await successful("get_records_by_date_range", { from: "2026-09-01", to: review.date }, "default read excludes reviews");
  assert.equal(defaults.records.length, expectedCurrentPaths.length + expectedPreviousPaths.length);
  assert.ok(defaults.records.every((record) => record.type !== "review"));
  console.table(timings);
  console.log("PASS: real HTTP MCP initialization, source reads, validation errors, corrected save, disk verification and overwrite protection.");
  console.log(fixture
    ? "Scope: live GitHub read -> temporary local copy -> real HTTP MCP -> local save/read-back. No remote writes, AI generation, hosted authentication or Netlify runtime."
    : "Scope: local storage and scripted MCP client; no AI generation, GitHub network, hosted authentication or Netlify runtime.");
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const forceKill = setTimeout(() => child.kill("SIGKILL"), 3_000);
    await exited;
    clearTimeout(forceKill);
  }
  await rm(root, { recursive: true, force: true });
}
