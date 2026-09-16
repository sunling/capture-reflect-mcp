import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = path.join(process.cwd(), "scripts/migrate-review-sources.mjs");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-source-migration-"));
  directories.push(root);
  const previous = "notes/2026/202609/20260914-旧笔记.md";
  const next = "notes/2026/202609/20260914-新笔记.md";
  const journal = "journals/2026/202609/20260914-日记.md";
  const review = "reviews/2026/202609/20260909-20260915-weekly.md";
  for (const file of [previous, journal, review]) await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, previous), "note");
  await fs.writeFile(path.join(root, journal), "journal");
  const original = [
    "---", 'title: "Weekly"', "source_paths:",
    `  - ${JSON.stringify(previous)}`, `  - ${JSON.stringify(journal)}`, "---", "",
    "Evidence: [旧笔记](../../../notes/2026/202609/20260914-%E6%97%A7%E7%AC%94%E8%AE%B0.md).",
    "See [journal][day].", "", "[day]: ../../../journals/2026/202609/20260914-%E6%97%A5%E8%AE%B0.md", "",
    `Legacy: \`${previous}\``, "",
  ].join("\n");
  await fs.writeFile(path.join(root, review), original);
  return { root, previous, next, journal, review, original };
}

function run(root: string, ...args: string[]) {
  return JSON.parse(execFileSync(process.execPath, [script, "--repo", root, ...args], { encoding: "utf8" }));
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("review source migration", () => {
  it("previews edits, repairs metadata and Unicode links, then passes a reference audit", async () => {
    const { root, previous, next, journal, review, original } = await fixture();
    await fs.rename(path.join(root, previous), path.join(root, next));
    const preview = run(root, "--from", previous, "--to", next);
    expect(preview).toMatchObject({ reviewed: 1, changes: [review], broken: [], written: false });
    expect(await fs.readFile(path.join(root, review), "utf8")).toBe(original);
    expect(run(root, "--from", previous, "--to", next, "--write")).toMatchObject({ broken: [], written: true });
    const updated = await fs.readFile(path.join(root, review), "utf8");
    expect(updated).toContain(`  - ${JSON.stringify(next)}`);
    expect(updated).toContain(`  - ${JSON.stringify(journal)}`);
    expect(updated).toContain("[旧笔记](../../../notes/2026/202609/20260914-%E6%96%B0%E7%AC%94%E8%AE%B0.md)");
    expect(updated).toContain(`[day]: ../../../journals/2026/202609/20260914-%E6%97%A5%E8%AE%B0.md`);
    expect(updated).toContain(`\`${next}\``);
    expect(updated).not.toContain(previous);
    expect(run(root)).toMatchObject({ reviewed: 1, changes: [], broken: [] });
    expect(await fs.readFile(path.join(root, next), "utf8")).toBe("note");
  });

  it("does not write any review if a source path or Markdown link is broken", async () => {
    const { root, previous, next, journal, review, original } = await fixture();
    await fs.rename(path.join(root, previous), path.join(root, next));
    await fs.rm(path.join(root, journal));
    const failure = spawnSync(process.execPath, [script, "--repo", root, "--from", previous, "--to", next, "--write"], { encoding: "utf8" });
    expect(failure.status).toBe(1);
    const report = JSON.parse(failure.stdout);
    expect(report.written).toBe(false);
    expect(report.broken.some((entry: string) => entry.includes(journal))).toBe(true);
    expect(await fs.readFile(path.join(root, review), "utf8")).toBe(original);
  });

  it("rejects unsafe mappings and never moves files itself", async () => {
    const { root, previous, next, review, original } = await fixture();
    for (const mapping of [["../notes", next], [previous, "reviews/moved"], [previous, "journals/2026/new.md"]]) {
      const failure = spawnSync(process.execPath, [script, "--repo", root, "--from", mapping[0]!, "--to", mapping[1]!, "--write"], { encoding: "utf8" });
      expect(failure.status).toBe(1);
    }
    expect(await fs.readFile(path.join(root, previous), "utf8")).toBe("note");
    expect(await fs.readFile(path.join(root, review), "utf8")).toBe(original);
  });
});
