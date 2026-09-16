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
  readonly requests = {
    tree: 0,
    contentsRead: 0,
    contentsWrite: 0,
    graphql: 0,
  };
  #revision = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/graphql" && method === "POST") {
      this.requests.graphql += 1;
      const body = JSON.parse(init?.body as string) as {
        variables: Record<string, string>;
      };
      const repository: Record<string, { oid: string; text: string } | null> = {};
      for (const [key, oid] of Object.entries(body.variables)) {
        if (!key.startsWith("oid")) continue;
        const index = key.slice("oid".length);
        const match = [...this.files.entries()].find(([, file]) => file.sha === oid);
        repository[`blob${index}`] = match
          ? { oid, text: match[1].content.toString("utf8") }
          : null;
      }
      return jsonResponse({ data: { repository } });
    }

    const prefix = "/repos/sunling/records/";
    if (!url.pathname.startsWith(prefix)) return jsonResponse({ message: "Not found" }, 404);
    const route = url.pathname.slice(prefix.length);

    if (method === "GET" && route.startsWith("git/trees/")) {
      this.requests.tree += 1;
      return jsonResponse({
        truncated: false,
        tree: [...this.files.entries()].map(([path, file]) => ({
          path,
          type: "blob",
          sha: file.sha,
        })),
      });
    }

    if (route.startsWith("contents/")) {
      const filePath = route
        .slice("contents/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");

      if (method === "PUT") {
        this.requests.contentsWrite += 1;
        const body = JSON.parse(init?.body as string) as {
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

      this.requests.contentsRead += 1;
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
  it("rejects mixed review ranges before writing, then saves the same body with exact in-range paths", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    await store.captureNote({ date: "2026-09-07", title: "Earlier", keyword: "earlier", content: "Earlier evidence." });
    await store.captureNote({ date: "2026-09-10", title: "本周", keyword: "本周", content: "Current evidence." });
    const previous = await store.getRecords({ from: "2026-09-01", to: "2026-09-07" });
    const current = await store.getRecords({ from: "2026-09-08", to: "2026-09-14" });
    const review = {
      date: "2026-09-15", from: "2026-09-08", to: "2026-09-14",
      title: "Weekly review", keyword: "weekly", content: "AI interpretation: this week has limited evidence.",
      sourcePaths: [...current, ...previous].map((record) => record.path),
    };
    const before = { ...api.requests };
    await expect(store.saveReview(review)).rejects.toThrow("Review source not found in the reviewed range");
    expect(api.requests.tree - before.tree).toBe(1);
    expect(api.requests.graphql - before.graphql).toBe(1);
    expect(api.requests.contentsWrite - before.contentsWrite).toBe(0);
    expect([...api.files.keys()].some((path) => path.startsWith("reviews/"))).toBe(false);

    const saved = await store.saveReview({ ...review, sourcePaths: current.map((record) => record.path) });
    expect(api.files.get(saved.path)?.content.toString()).toContain(review.content);
    await expect(store.saveReview({ ...review, sourcePaths: current.map((record) => record.path) })).rejects.toThrow();
  });

  it("saves linked reviews without mixing them into default reads or overwriting", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    const note = await store.captureNote({ date: "2026-09-01", title: "散步", keyword: "散步", content: "A walk helped me focus." });
    const input = { date: "2026-09-14", from: "2026-09-01", to: "2026-09-07", title: "Weekly review", keyword: "weekly", content: "## Interpretation (AI)\nWalking may help focus.\n\n## Questions\nDoes this recur?", sourcePaths: [note.path] };
    const result = await store.saveReview(input);
    expect(result).toEqual({ path: "reviews/2026/202609/20260914-weekly.md", action: "created" });
    const reviews = await store.getRecords({ from: "2026-09-14", to: "2026-09-14", types: ["review"] });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.content).toContain("from: 2026-09-01");
    expect(reviews[0]?.content).toContain("../../../notes/2026/202609/20260901-%E6%95%A3%E6%AD%A5.md");
    expect(reviews[0]?.content).toContain(input.content);
    expect(await store.getRecords({ from: "2026-09-01", to: "2026-09-30" })).toHaveLength(1);
    expect(await store.searchRecords({ query: "Does this recur?" })).toHaveLength(0);
    expect(await store.searchRecords({ query: "Does this recur?", types: ["review"] })).toHaveLength(1);
    expect(await store.getRecords({ from: input.from, to: input.to, types: ["review"] })).toHaveLength(0);
    await expect(store.saveReview({ ...input, content: "replacement" })).rejects.toThrow();
    expect((await store.getRecords({ from: "2026-09-14", to: "2026-09-14", types: ["review"] }))[0]?.content).toBe(reviews[0]?.content);
    for (const sourcePaths of [[], ["../secret.md"], ["reviews/2026/202609/20260914-weekly.md"], ["notes/missing.md"]]) {
      await expect(store.saveReview({ ...input, keyword: "invalid", sourcePaths })).rejects.toThrow();
    }
    await expect(store.saveReview({ ...input, keyword: "outside", from: "2026-09-02" })).rejects.toThrow();
    expect(await store.getRecords({ from: "2026-09-01", to: "2026-09-30", types: ["review"] })).toHaveLength(1);
  });

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

  it("batches record reads instead of issuing one contents request per file", async () => {
    const api = new FakeGitHubApi();
    const store = createStore(api);
    for (let index = 0; index < 120; index += 1) {
      const suffix = String(index).padStart(3, "0");
      api.files.set(`notes/2026/202609/20260901-note-${suffix}.md`, {
        content: Buffer.from(index === 119 ? "needle appears here" : `record ${index}`),
        sha: `bulk-sha-${index}`,
      });
    }

    const matches = await store.searchRecords({ query: "needle" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("notes/2026/202609/20260901-note-119.md");
    expect(api.requests).toEqual({
      tree: 1,
      contentsRead: 0,
      contentsWrite: 0,
      graphql: 3,
    });
  });
});
