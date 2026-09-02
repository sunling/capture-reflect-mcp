import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalRecordsStore } from "../src/storage/local-records.js";

describe("LocalRecordsStore", () => {
  let root: string;
  let store: LocalRecordsStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "log-reflect-mcp-"));
    store = new LocalRecordsStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
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
    expect(appended).toEqual({
      path: created.path,
      action: "appended",
      attachmentPaths: [],
    });
    const content = await fs.readFile(path.join(root, created.path), "utf8");
    expect(content).toContain("### 第一次记录");
    expect(content).toContain("### 后来想到");
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
      "daily/journals/2026/202608/images/20260831-散步-1.jpg",
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

    expect(created.path).toBe("daily/notes/2026/202608/20260823-生命力.md");
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
