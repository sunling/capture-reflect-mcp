import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { journalFileName, journalHeading } from "../src/storage/record-utils.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function localStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "capture-reflect-headings-"));
  directories.push(root);
  return { root, store: new LocalRecordsStore(root) };
}

describe("journal headings", () => {
  it("formats the record date and weekday in Chinese without changing its filename", () => {
    const input = {
      date: "2026-09-15",
      title: "记录系统优化",
      keyword: "记录系统优化",
      content: "今天进行了调整。",
    };
    expect(journalFileName(input)).toBe("20260915-记录系统优化.md");
    expect(journalHeading(input)).toBe("# 2026年9月15日 · 周二\n\n");
  });

  it("uses an English heading for English journal entries", () => {
    expect(journalHeading({
      date: "2026-09-15", title: "A morning walk", keyword: "walk", content: "I went outside.",
    })).toBe("# September 15, 2026 · Tuesday\n\n");
  });

  it("keeps the weekday aligned to the journal date, including a Sunday", () => {
    expect(journalHeading({
      date: "2026-09-13", title: "回家", keyword: "回家", content: "旅行结束。",
    })).toBe("# 2026年9月13日 · 周日\n\n");
  });

  it("creates one day-level heading and does not repeat it when appending", async () => {
    const { root, store } = await localStore();
    const first = await store.captureJournal({
      date: "2026-09-15", title: "早餐", keyword: "早晨", content: "吃了早饭。",
    });
    const second = await store.captureJournal({
      date: "2026-09-15", title: "晚间", keyword: "晚上", content: "补充今天的记录。",
    });
    const body = await fs.readFile(path.join(root, first.path), "utf8");
    expect(first.path).toBe("journals/2026/202609/20260915-早晨.md");
    expect(second).toMatchObject({ action: "appended", path: first.path });
    expect(body).toMatch(/^# 2026年9月15日 · 周二\n\n### 早餐\n\n吃了早饭。/);
    expect(body).toContain("### 晚间\n\n补充今天的记录。");
    expect(body.match(/^# /gm)).toHaveLength(1);
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
  });
});
