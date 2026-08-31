import {
  assertDate,
  assertKeyword,
  buildInputDocument,
  buildJournalFragment,
  compactDate,
  inputDirectory,
  journalDirectory,
  journalFileName,
  recordDateFromPath,
} from "./record-utils.js";
import type {
  CaptureInputInput,
  CaptureJournalInput,
  RecordsStore,
  RecordType,
  StoredRecord,
} from "./records-store.js";

interface GitHubRecordsStoreOptions {
  repository: string;
  token: string;
  branch?: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface GitHubContentItem {
  path: string;
  name: string;
  type: "file" | "dir" | string;
  sha: string;
}

interface GitHubFile extends GitHubContentItem {
  content: string;
  encoding: string;
}

interface GitHubTree {
  truncated: boolean;
  tree: Array<{ path?: string; type?: string }>;
}

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function encodedPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  transform: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await transform(values[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export class GitHubRecordsStore implements RecordsStore {
  readonly #repositoryPath: string;
  readonly #token: string;
  readonly #branch: string;
  readonly #apiBaseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: GitHubRecordsStoreOptions) {
    const parts = options.repository.trim().split("/");
    if (parts.length !== 2 || parts.some((part) => !part)) {
      throw new Error("GitHub repository must use the owner/name format.");
    }
    if (!options.token.trim()) throw new Error("GitHub token must not be empty.");

    this.#repositoryPath = parts.map(encodeURIComponent).join("/");
    this.#token = options.token.trim();
    this.#branch = options.branch?.trim() || "main";
    this.#apiBaseUrl = `${(options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "")}/`;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async captureJournal(
    input: CaptureJournalInput,
  ): Promise<{ path: string; action: "created" | "appended" }> {
    assertDate(input.date);
    assertKeyword(input.keyword);

    const directory = journalDirectory(input.date);
    const compact = compactDate(input.date);
    const existing = await this.#journalFilesForDate(directory, compact);
    if (existing.length > 1) {
      throw new Error(
        `Multiple journal files already exist for ${input.date}; choose one explicitly before writing.`,
      );
    }

    const fragment = buildJournalFragment(input);
    if (existing.length === 1) {
      await this.#appendJournal(existing[0]!.path, fragment, input.date);
      return { path: existing[0]!.path, action: "appended" };
    }

    const filePath = `${directory}/${journalFileName(input)}`;
    try {
      await this.#putFile(
        filePath,
        fragment,
        `log-reflect: record journal for ${input.date}`,
      );
      return { path: filePath, action: "created" };
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;

      const concurrent = await this.#journalFilesForDate(directory, compact);
      if (concurrent.length !== 1) throw error;
      await this.#appendJournal(concurrent[0]!.path, fragment, input.date);
      return { path: concurrent[0]!.path, action: "appended" };
    }
  }

  async captureInput(input: CaptureInputInput): Promise<{ path: string; action: "created" }> {
    assertDate(input.date);
    assertKeyword(input.keyword);

    const filePath = `${inputDirectory(input.date)}/${compactDate(input.date)}-${input.keyword}.md`;
    try {
      await this.#putFile(
        filePath,
        buildInputDocument(input),
        `log-reflect: record input for ${input.date}`,
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) {
        throw new Error(`An input record already exists at ${filePath}.`);
      }
      throw error;
    }
    return { path: filePath, action: "created" };
  }

  async getRecords(options: {
    from: string;
    to: string;
    types?: RecordType[];
  }): Promise<StoredRecord[]> {
    assertDate(options.from);
    assertDate(options.to);
    if (options.from > options.to) throw new Error("from must be on or before to.");

    const requested = new Set(options.types ?? ["journal", "input"]);
    const paths = (await this.#listRecordPaths()).filter((filePath) => {
      const date = recordDateFromPath(filePath);
      const type = filePath.startsWith("daily/journal/") ? "journal" : "input";
      return Boolean(
        date && date >= options.from && date <= options.to && requested.has(type),
      );
    });

    const records = await mapWithConcurrency(paths, 8, async (filePath): Promise<StoredRecord> => {
      const file = await this.#getFile(filePath);
      return {
        path: filePath,
        date: recordDateFromPath(filePath)!,
        type: filePath.startsWith("daily/journal/") ? "journal" : "input",
        content: file.content,
      };
    });
    return records.sort((a, b) => a.path.localeCompare(b.path));
  }

  async searchRecords(options: {
    query: string;
    from?: string;
    to?: string;
    types?: RecordType[];
    limit?: number;
  }): Promise<Array<StoredRecord & { excerpts: string[] }>> {
    const query = options.query.trim().toLocaleLowerCase();
    if (!query) throw new Error("query must not be empty.");

    const records = await this.getRecords({
      from: options.from ?? "0001-01-01",
      to: options.to ?? "9999-12-31",
      ...(options.types ? { types: options.types } : {}),
    });
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    return records
      .flatMap((record) => {
        const excerpts = record.content
          .split("\n")
          .filter((line) => line.toLocaleLowerCase().includes(query))
          .slice(0, 3);
        return excerpts.length > 0 ? [{ ...record, excerpts }] : [];
      })
      .slice(0, limit);
  }

  async #journalFilesForDate(directory: string, compact: string): Promise<GitHubContentItem[]> {
    const entries = await this.#listDirectory(directory);
    return entries.filter(
      (entry) =>
        entry.type === "file" && entry.name.startsWith(compact) && entry.name.endsWith(".md"),
    );
  }

  async #appendJournal(filePath: string, fragment: string, date: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.#getFile(filePath);
      try {
        await this.#putFile(
          filePath,
          `${existing.content}\n${fragment}`,
          `log-reflect: append journal for ${date}`,
          existing.sha,
        );
        return;
      } catch (error) {
        if (
          !(error instanceof GitHubApiError) ||
          (error.status !== 409 && error.status !== 422) ||
          attempt === 2
        ) {
          throw error;
        }
      }
    }
  }

  async #listRecordPaths(): Promise<string[]> {
    const tree = (await this.#request<GitHubTree>(
      "GET",
      `repos/${this.#repositoryPath}/git/trees/${encodeURIComponent(this.#branch)}?recursive=1`,
    ))!;
    if (tree.truncated) {
      throw new Error("The GitHub repository tree is too large to search safely.");
    }
    return tree.tree
      .flatMap((item) => (item.type === "blob" && item.path ? [item.path] : []))
      .filter(
        (filePath) =>
          filePath.endsWith(".md") &&
          (filePath.startsWith("daily/journal/") || filePath.startsWith("daily/inputs/")),
      );
  }

  async #listDirectory(directory: string): Promise<GitHubContentItem[]> {
    const result = await this.#request<GitHubContentItem[]>(
      "GET",
      `repos/${this.#repositoryPath}/contents/${encodedPath(directory)}?ref=${encodeURIComponent(this.#branch)}`,
      undefined,
      true,
    );
    return result ?? [];
  }

  async #getFile(filePath: string): Promise<{ content: string; sha: string }> {
    const file = (await this.#request<GitHubFile>(
      "GET",
      `repos/${this.#repositoryPath}/contents/${encodedPath(filePath)}?ref=${encodeURIComponent(this.#branch)}`,
    ))!;
    if (file.type !== "file" || file.encoding !== "base64") {
      throw new Error(`GitHub returned an unsupported file response for ${filePath}.`);
    }
    return {
      content: Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8"),
      sha: file.sha,
    };
  }

  async #putFile(
    filePath: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<void> {
    await this.#request(
      "PUT",
      `repos/${this.#repositoryPath}/contents/${encodedPath(filePath)}`,
      {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: this.#branch,
        ...(sha ? { sha } : {}),
      },
    );
  }

  async #request<T>(
    method: "GET" | "PUT",
    apiPath: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<T | undefined> {
    const response = await this.#fetch(new URL(apiPath, this.#apiBaseUrl), {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.#token}`,
        "content-type": "application/json",
        "user-agent": "log-reflect-mcp",
        "x-github-api-version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (allowNotFound && response.status === 404) return undefined;
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new GitHubApiError(
        response.status,
        `GitHub API ${method} failed (${response.status}): ${payload.message ?? response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }
}
