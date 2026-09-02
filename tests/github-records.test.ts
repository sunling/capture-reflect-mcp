import { describe, expect, it } from "vitest";
import { GitHubRecordsStore } from "../src/storage/github-records.js";

interface FakeFile {
  content: Buffer;
  sha: string;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeGitHubApi {
  readonly files = new Map<string, FakeFile>();
  #revision = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const prefix = "/repos/sunling/records/";
    if (!url.pathname.startsWith(prefix)) return jsonResponse({ message: "Not found" }, 404);
    const route = url.pathname.slice(prefix.length);

    if (init?.method === "GET" && route.startsWith("git/trees/")) {
      return jsonResponse({
        truncated: false,
        tree: [...this.files.keys()].map((path) => ({ path, type: "blob" })),
      });
    }

    if (route.startsWith("contents/")) {
      const filePath = route
        .slice("contents/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");

      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as {
          content: string;
          sha?: string;
        };
        const existing = this.files.get(filePath);
        if (existing && !body.sha) return jsonResponse({ message: "Already exists" }, 422);
        if (existing && body.sha !== existing.sha) {
          return jsonResponse({ message: "SHA does not match" }, 409);
        }
        if (!existing && body.sha) return jsonResponse({ message: "File is missing" }, 422);

        const sha = `sha-${++this.#revision}`;
        this.files.set(filePath, {
          content: Buffer.from(body.content, "base64"),
          sha,
        });
        return jsonResponse({ content: { path: filePath, sha } }, existing ? 200 : 201);
      }

      const file = this.files.get(filePath);
      if (file) {
        return jsonResponse({
          path: filePath,
          name: filePath.split("/").at(-1),
          type: "file",
          sha: file.sha,
          content: file.content.toString("base64"),
          encoding: "base64",
        });
      }

      const directoryPrefix = `${filePath}/`;
      const entries = [...this.files.entries()].flatMap(([path, value]) => {
        if (!path.startsWith(directoryPrefix)) return [];
        const remaining = path.slice(directoryPrefix.length);
        if (remaining.includes("/")) return [];
        return [{ path, name: remaining, type: "file", sha: value.sha }];
      });
      return entries.length > 0 ? jsonResponse(entries) : jsonResponse({ message: "Not found" }, 404);
    }

    return jsonResponse({ message: "Not found" }, 404);
  };
}

function createStore(api: FakeGitHubApi): GitHubRecordsStore {
  return new GitHubRecordsStore({
    repository: "sunling/records",
    token: "test-token",
    fetch: api.fetch,
  });
}

describe("GitHubRecordsStore", () => {
  it("initializes the canonical record directories without overwriting files", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);

    await expect(store.initializeRepository()).resolves.toEqual({
      created: [
        "notes/.gitkeep",
        "journals/.gitkeep",
        "reviews/.gitkeep",
      ],
    });
    await expect(store.initializeRepository()).resolves.toEqual({ created: [] });
  });

  it("creates and then safely appends to a journal file", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);

    const created = await store.captureJournal({
      date: "2026-08-31",
      title: "下午",
      keyword: "继续开发",
      content: "继续完善记录系统。",
    });
    const appended = await store.captureJournal({
      date: "2026-08-31",
      title: "后来",
      keyword: "不会改名",
      content: "补充第二段。",
    });

    expect(created.action).toBe("created");
    expect(appended).toEqual({
      path: created.path,
      action: "appended",
      attachmentPaths: [],
    });
    const content = api.files.get(created.path)?.content.toString("utf8");
    expect(content).toContain("### 下午");
    expect(content).toContain("### 后来");
  });

  it("stores an image and links it from the journal Markdown", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    const image = Buffer.from([0, 1, 2, 255]);

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
    expect(api.files.get(created.attachmentPaths[0]!)?.content).toEqual(image);
    expect(api.files.get(created.path)?.content.toString("utf8")).toContain(
      "![遛猫](images/20260831-散步-1.jpg)",
    );
  });

  it("does not overwrite an existing note", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    const note = {
      date: "2026-08-31",
      title: "一篇文章",
      keyword: "文章",
      content: "值得保留。",
    };

    await store.captureNote(note);
    await expect(store.captureNote(note)).rejects.toThrow("already exists");
  });

  it("retrieves and searches only journal and note Markdown files", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    await store.captureJournal({
      date: "2026-08-30",
      title: "咖啡店",
      keyword: "咖啡店",
      content: "在咖啡店看见有人写纸质日记。",
    });
    await store.captureNote({
      date: "2026-08-31",
      title: "创作",
      keyword: "创作",
      content: "作品也许带着生命力。",
    });
    api.files.set("PROFILE.md", { content: Buffer.from("生命力"), sha: "outside" });

    const records = await store.getRecords({ from: "2026-08-30", to: "2026-08-31" });
    const matches = await store.searchRecords({ query: "生命力" });

    expect(records).toHaveLength(2);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.type).toBe("note");
  });

});
