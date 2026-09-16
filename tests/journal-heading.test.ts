import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";
import { withRecordEditing } from "../src/storage/record-editing.js";
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
  it("uses only the date for a journal filename, not the first fragment topic or language", () => {
    const input = {
      date: "2026-09-15",
      title: "记录系统优化",
      keyword: "记录系统优化",
      content: "今天进行了调整。",
    };
    expect(journalFileName(input)).toBe("20260915.md");
    expect(journalFileName({ ...input, keyword: "another-language", title: "Daily reflection" })).toBe("20260915.md");
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

  it("creates one stable ID and day-level heading without repeating them when appending", async () => {
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
    await expect(fs.access(path.join(directory, "20260915.md"))).rejects.toThrow();
  });

  it("refuses ambiguous canonical and legacy files without appending to either", async () => {
    const { root, store } = await localStore();
    const directory = path.join(root, "journals/2026/202609");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "20260915.md"), "canonical");
    await fs.writeFile(path.join(directory, "20260915-old.md"), "legacy");
    await expect(store.captureJournal({ date: "2026-09-15", title: "新", keyword: "新", content: "should not appear" }))
      .rejects.toThrow("Multiple journal files");
    expect(await fs.readFile(path.join(directory, "20260915.md"), "utf8")).toBe("canonical");
    expect(await fs.readFile(path.join(directory, "20260915-old.md"), "utf8")).toBe("legacy");
  });

  it("allows explicit safe edits of the new date-only path and old keyword paths", async () => {
    const { root, store } = await localStore();
    const editable = withRecordEditing(store, { kind: "local", root });
    const journal = await editable.captureJournal({ date: "2026-09-15", title: "上午", keyword: "上午", content: "第一段。" });
    await expect(editable.updateRecord!({ path: journal.path, mode: "append", content: "### 午后\n\n第二段。" }))
      .resolves.toMatchObject({ path: journal.path, action: "appended" });
    expect(await fs.readFile(path.join(root, journal.path), "utf8")).toContain("第二段。");
    await expect(editable.updateRecord!({ path: "notes/2026/202609/20260915.md", mode: "append", content: "unsafe" }))
      .rejects.toThrow("exact journal/note path");
  });
});
