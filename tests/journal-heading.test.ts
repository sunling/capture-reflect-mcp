import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { journalFileName, journalHeading } from "../src/storage/record-utils.js";
import { recordId } from "../src/storage/record-graph.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function localStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "capture-reflect-headings-"));
  directories.push(root);
  return { root, store: new LocalRecordsStore(root) };
}

const idHeader = /^---\nid: cr_[0-9a-f-]{36}\n---\n\n/;

describe("journal headings", () => {
  it("names a daily file by date irrespective of the first fragment's keyword or language", () => {
    const input = {
      date: "2026-09-15",
      title: "记录系统优化",
      keyword: "记录系统优化",
      content: "今天进行了调整。",
    };
    expect(journalFileName(input)).toBe("20260915.md");
    expect(journalFileName({ date: "2026-09-15" })).toBe("20260915.md");
    expect(journalHeading(input)).toMatch(idHeader);
    expect(journalHeading(input)).toMatch(/# 2026年9月15日 · 周二\n\n$/);
  });

  it("uses an English heading for English journal entries", () => {
    const heading = journalHeading({
      date: "2026-09-15", title: "A morning walk", keyword: "walk", content: "I went outside.",
    });
    expect(heading).toMatch(idHeader);
    expect(heading).toContain("# September 15, 2026 · Tuesday\n\n");
  });

  it("keeps the weekday aligned to the journal date, including a Sunday", () => {
    expect(journalHeading({
      date: "2026-09-13", title: "回家", keyword: "回家", content: "旅行结束。",
    })).toContain("# 2026年9月13日 · 周日\n\n");
  });

  it("creates one stable ID and one day-level heading without repeating them when appending", async () => {
    const { root, store } = await localStore();
    const first = await store.captureJournal({
      date: "2026-09-15", title: "早餐", keyword: "早晨", content: "吃了早饭。",
    });
    const initial = await fs.readFile(path.join(root, first.path), "utf8");
    const initialId = recordId(initial);
    const second = await store.captureJournal({
      date: "2026-09-15", title: "晚间", keyword: "晚上", content: "补充今天的记录。",
    });
    const body = await fs.readFile(path.join(root, first.path), "utf8");
    expect(first.path).toBe("journals/2026/202609/20260915.md");
    expect(second).toMatchObject({ action: "appended", path: first.path });
    expect(body).toMatch(idHeader);
    expect(body).toContain("# 2026年9月15日 · 周二\n\n### 早餐\n\n吃了早饭。");
    expect(body).toContain("### 晚间\n\n补充今天的记录。");
    expect(body.match(/^# /gm)).toHaveLength(1);
    expect(initialId).toMatch(/^cr_/);
    expect(recordId(body)).toBe(initialId);
    expect(body.match(/^id: /gm)).toHaveLength(1);
  });

  it("appends to an older journal without rewriting its existing body or filename", async () => {
    const { root, store } = await localStore();
    const directory = path.join(root, "journals/2026/202609");
    await fs.mkdir(directory, { recursive: true });
    const legacy = "journals/2026/202609/20260915-周二-旧文件名.md";
    await fs.writeFile(path.join(root, legacy), "### 旧记录\n\n保留原文。\n");
    const result = await store.captureJournal({
      date: "2026-09-15", title: "追加", keyword: "新词", content: "新内容。",
    });
    expect(result).toMatchObject({ path: legacy, action: "appended" });
    const body = await fs.readFile(path.join(root, legacy), "utf8");
    expect(body).toMatch(/^### 旧记录\n\n保留原文。\n/);
    expect(body).toContain("### 追加\n\n新内容。");
    expect(body).not.toContain("# 2026年");
    expect(recordId(body)).toBeUndefined();
    expect(await fs.readdir(directory)).toEqual(["20260915-周二-旧文件名.md"]);
  });
});
