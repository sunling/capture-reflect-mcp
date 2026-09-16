import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";

describe("LocalRecordsStore", () => {
  let root: string;
  let store: LocalRecordsStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "capture-reflect-mcp-"));
    store = new LocalRecordsStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("saves reviews with one metadata inventory and no duplicated source footer", async () => {
    const note = await store.captureNote({ date: "2026-09-01", title: "散步", keyword: "散步", content: "A walk helped me focus." });
    const input = { date: "2026-09-14", from: "2026-09-01", to: "2026-09-07", title: "Weekly review", keyword: "weekly", content: "## Interpretation (AI)\nWalking may help focus.\n\n## Questions\nDoes this recur?", sourcePaths: [note.path] };
    const result = await store.saveReview(input);
    expect(result).toEqual({ path: "reviews/2026/202609/20260901-20260907-weekly.md", action: "created" });
    const reviews = await store.getRecords({ from: "2026-09-14", to: "2026-09-14", types: ["review"] });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.content).toContain("from: 2026-09-01");
    expect(reviews[0]?.content).toContain(`  - ${JSON.stringify(note.path)}`);
    expect(reviews[0]?.content).not.toContain("../../../notes/");
    expect(reviews[0]?.content).toContain(input.content);
    expect(await store.getRecords({ from: "2026-09-01", to: "2026-09-30" })).toHaveLength(1);
    expect(await store.searchRecords({ query: "Does this recur?" })).toHaveLength(0);
    expect(await store.searchRecords({ query: "Does this recur?", types: ["review"] })).toHaveLength(1);
    expect(await store.getRecords({ from: input.from, to: input.to, types: ["review"] })).toHaveLength(0);
    await expect(store.saveReview({ ...input, content: "replacement" })).rejects.toThrow();
    expect((await store.getRecords({ from: "2026-09-14", to: "2026-09-14", types: ["review"] }))[0]?.content).toBe(reviews[0]?.content);
    for (const sourcePaths of [[], ["../secret.md"], ["reviews/2026/202609/20260901-20260907-weekly.md"], ["notes/missing.md"]]) {
      await expect(store.saveReview({ ...input, keyword: "invalid", sourcePaths })).rejects.toThrow();
    }
    await expect(store.saveReview({ ...input, keyword: "outside", from: "2026-09-02" })).rejects.toThrow();
    expect(await store.getRecords({ from: "2026-09-01", to: "2026-09-30", types: ["review"] })).toHaveLength(1);
  });

  it("creates and then appends to a journal file for the same day", async () => {
    const created = await store.captureJournal({
      date: "2026-08-24",
      title: "第一次记录",
      keyword: "咖啡店",
      content: "今天在咖啡店想到了一件事。",
    });
    const appended = await store.captureJournal({
      date: "2026-08-24",
      title: "后来想到",
      keyword: "不会改文件名",
      content: "晚上又补充了一点。",
    });

    expect(created.action).toBe("created");
    expect(created.path).toBe("journals/2026/202608/20260824-咖啡店.md");
    expect(appended).toEqual({
      path: created.path,
      action: "appended",
      attachmentPaths: [],
    });
    const content = await fs.readFile(path.join(root, created.path), "utf8");
    expect(content).toContain("### 第一次记录");
    expect(content).toContain("### 后来想到");
  });

  it("names reviews by range and topic while reading new and legacy reviews by save date", async () => {
    const note = await store.captureNote({ date: "2026-09-05", title: "计划", keyword: "计划", content: "Original evidence" });
    const saved = await store.saveReview({ date: "2026-10-02", from: "2026-09-05", to: "2026-09-11", title: "计划被打乱之后", keyword: "计划被打乱之后", content: "review-marker", sourcePaths: [note.path] });
    expect(saved.path).toBe("reviews/2026/202610/20260905-20260911-计划被打乱之后.md");
    const legacy = "reviews/2026/202610/20261002-legacy.md";
    await fs.writeFile(path.join(root, legacy), "review-marker");
    const records = await store.getRecords({ from: "2026-10-02", to: "2026-10-02", types: ["review"] });
    expect(records.map((record) => record.path)).toEqual([saved.path, legacy]);
    expect(records.every((record) => record.date === "2026-10-02")).toBe(true);
    expect(await store.getRecords({ from: "2026-09-05", to: "2026-09-11", types: ["review"] })).toEqual([]);
    expect(await store.searchRecords({ query: "review-marker", from: "2026-10-02", to: "2026-10-02", types: ["review"] })).toHaveLength(2);
  });

  it("appends to an existing journal with a legacy weekday filename", async () => {
    const directory = path.join(root, "journals/2026/202608");
    await fs.mkdir(directory, { recursive: true });
    const legacyPath = "journals/2026/202608/20260831-周一-walk.md";
    await fs.writeFile(path.join(root, legacyPath), "### Walk\n\nOriginal entry.\n");
    const result = await store.captureJournal({ date: "2026-08-31", title: "Later", keyword: "हिन्दी", content: "Another thought." });
    expect(result.path).toBe(legacyPath);
    expect(result.action).toBe("appended");
    expect(await fs.readdir(directory)).toEqual(["20260831-周一-walk.md"]);
    expect(await fs.readFile(path.join(root, legacyPath), "utf8")).toContain("Another thought.");
  });

  it("stores an image beside a journal and inserts a relative Markdown link", async () => {
    const image = Buffer.from("processed-image");
    const created = await store.captureJournal({
      date: "2026-08-31",
      title: "散步",
      keyword: "散步",
      content: "今天带猫出门。",
      attachments: [
        {
          data: image,
          extension: "jpg",
          mimeType: "image/jpeg",
          alt: "遛猫",
        },
      ],
    });

    expect(created.attachmentPaths).toEqual([
      "journals/2026/202608/images/20260831-散步-1.jpg",
    ]);
    await expect(
      fs.readFile(path.join(root, created.attachmentPaths[0]!)),
    ).resolves.toEqual(image);
    await expect(fs.readFile(path.join(root, created.path), "utf8")).resolves.toContain(
      "![遛猫](images/20260831-散步-1.jpg)",
    );
  });

  it("creates a note and retrieves it by date", async () => {
    const created = await store.captureNote({
      date: "2026-08-23",
      title: "Energetic charge",
      keyword: "生命力",
      source: "The Creative Act",
      tags: ["阅读", "创作"],
      content: "## 为什么此刻想留下\n\n我在想作品是否能代表我正在经历的。",
    });
    const records = await store.getRecords({ from: "2026-08-23", to: "2026-08-23" });

    expect(created.path).toBe("notes/2026/202608/20260823-生命力.md");
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toContain('source: "The Creative Act"');
  });

  it("creates the records directory tree on the first write", async () => {
    const newRoot = path.join(root, "not-created-yet", "records");
    const newStore = new LocalRecordsStore(newRoot);

    const created = await newStore.captureNote({
      date: "2026-08-27",
      title: "零配置记录",
      keyword: "开始",
      content: "第一次写入时创建本地目录。",
    });

    await expect(fs.readFile(path.join(newRoot, created.path), "utf8")).resolves.toContain(
      "第一次写入时创建本地目录。",
    );
  });

  it("searches matching lines without scanning outside record directories", async () => {
    await store.captureJournal({
      date: "2026-08-24",
      title: "关于效率",
      keyword: "效率",
      content: "这些不高效的活一定要被摒弃吗？",
    });
    await fs.writeFile(path.join(root, "PROFILE.md"), "效率", "utf8");

    const results = await store.searchRecords({ query: "高效" });
    expect(results).toHaveLength(1);
    expect(results[0]?.excerpts).toEqual(["这些不高效的活一定要被摒弃吗？"]);
  });
});
