import {
  assertDate,
  assertKeyword,
  attachmentMarkdown,
  buildJournalFragment,
  buildNoteDocument,
  compactDate,
  journalDirectory,
  journalFileName,
  noteDirectory,
  recordDateFromPath,
} from "./record-utils.js";
import type {
  CaptureJournalInput,
  CaptureNoteInput,
  CaptureResult,
  RecordAttachment,
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

  async initializeRepository(): Promise<{ created: string[] }> {
    const created: string[] = [];
    for (const directory of ["notes", "journals", "reviews"]) {
      if ((await this.#listDirectory(directory)).length > 0) continue;
      const marker = `${directory}/.gitkeep`;
      try {
        await this.#putFile(marker, "", "capture-reflect: initialize records repository");
        created.push(marker);
      } catch (error) {
        if (!(error instanceof GitHubApiError) || ![404, 409, 422].includes(error.status)) {
          throw error;
        }
        if ((await this.#listDirectory(directory)).length > 0) continue;
        if (created.length > 0) throw error;

        // A repository with no commits has no branch ref yet. Omitting the
        // branch lets GitHub create the first commit on its default branch.
        await this.#putFile(
          marker,
          "",
          "capture-reflect: initialize records repository",
          undefined,
          false,
        );
        created.push(marker);
      }
    }
    return { created };
  }

  async captureJournal(
    input: CaptureJournalInput,
  ): Promise<CaptureResult> {
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

    const storedAttachments = await this.#writeAttachments(
      "journal",
      input.date,
      input.keyword,
      input.attachments ?? [],
    );
    const imageMarkdown = attachmentMarkdown(storedAttachments);
    const fragment = buildJournalFragment({
      ...input,
      content: imageMarkdown ? `${input.content.trim()}\n\n${imageMarkdown}` : input.content,
    });
    if (existing.length === 1) {
      await this.#appendJournal(existing[0]!.path, fragment, input.date);
      return {
        path: existing[0]!.path,
        action: "appended",
        attachmentPaths: storedAttachments.map((attachment) => attachment.path),
      };
    }

    const filePath = `${directory}/${journalFileName(input)}`;
    try {
      await this.#putFile(
        filePath,
        fragment,
        `capture-reflect: record journal entry for ${input.date}`,
      );
      return {
        path: filePath,
        action: "created",
        attachmentPaths: storedAttachments.map((attachment) => attachment.path),
      };
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;

      const concurrent = await this.#journalFilesForDate(directory, compact);
      if (concurrent.length !== 1) throw error;
      await this.#appendJournal(concurrent[0]!.path, fragment, input.date);
      return {
        path: concurrent[0]!.path,
        action: "appended",
        attachmentPaths: storedAttachments.map((attachment) => attachment.path),
      };
    }
  }

  async captureNote(
    note: CaptureNoteInput,
  ): Promise<CaptureResult & { action: "created" }> {
    assertDate(note.date);
    assertKeyword(note.keyword);

    const filePath = `${noteDirectory(note.date)}/${compactDate(note.date)}-${note.keyword}.md`;
    const existing = await this.#listDirectory(noteDirectory(note.date));
    if (existing.some((entry) => entry.type === "file" && entry.path === filePath)) {
      throw new Error(`A note already exists at ${filePath}.`);
    }

    const storedAttachments = await this.#writeAttachments(
      "note",
      note.date,
      note.keyword,
      note.attachments ?? [],
    );
    const imageMarkdown = attachmentMarkdown(storedAttachments);
    try {
      await this.#putFile(
        filePath,
        buildNoteDocument({
          ...note,
          content: imageMarkdown ? `${note.content.trim()}\n\n${imageMarkdown}` : note.content,
        }),
        `capture-reflect: save note for ${note.date}`,
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) {
        throw new Error(`A note already exists at ${filePath}.`);
      }
      throw error;
    }
    return {
      path: filePath,
      action: "created",
      attachmentPaths: storedAttachments.map((attachment) => attachment.path),
    };
  }

  async #writeAttachments(
    type: RecordType,
    date: string,
    keyword: string,
    attachments: RecordAttachment[],
  ): Promise<Array<{ path: string; alt: string }>> {
    if (attachments.length === 0) return [];

    const baseDirectory = type === "journal" ? journalDirectory(date) : noteDirectory(date);
    const imageDirectory = `${baseDirectory}/images`;
    const existingNames = new Set(
      (await this.#listDirectory(imageDirectory))
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.name),
    );
    const compact = compactDate(date);
    const stored: Array<{ path: string; alt: string }> = [];

    for (const [index, attachment] of attachments.entries()) {
      let suffix = index + 1;
      while (true) {
        const fileName = `${compact}-${keyword}-${suffix}.${attachment.extension}`;
        if (existingNames.has(fileName)) {
          suffix += 1;
          continue;
        }
        const filePath = `${imageDirectory}/${fileName}`;
        try {
          await this.#putFile(
            filePath,
            attachment.data,
            `capture-reflect: add image for ${date}`,
          );
          existingNames.add(fileName);
          stored.push({ path: filePath, alt: attachment.alt });
          break;
        } catch (error) {
          if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
          suffix += 1;
        }
      }
    }
    return stored;
  }

  async getRecords(options: {
    from: string;
    to: string;
    types?: RecordType[];
  }): Promise<StoredRecord[]> {
    assertDate(options.from);
    assertDate(options.to);
    if (options.from > options.to) throw new Error("from must be on or before to.");

    const requested = new Set(options.types ?? ["journal", "note"]);
    const paths = (await this.#listRecordPaths()).filter((filePath) => {
      const date = recordDateFromPath(filePath);
      const type = filePath.startsWith("journals/") ? "journal" : "note";
      return Boolean(
        date && date >= options.from && date <= options.to && requested.has(type),
      );
    });

    const records = await mapWithConcurrency(paths, 8, async (filePath): Promise<StoredRecord> => {
      const file = await this.#getFile(filePath);
      return {
        path: filePath,
        date: recordDateFromPath(filePath)!,
        type: filePath.startsWith("journals/") ? "journal" : "note",
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
          `capture-reflect: append journal entry for ${date}`,
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
          (filePath.startsWith("journals/") || filePath.startsWith("notes/")),
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
    content: string | Uint8Array,
    message: string,
    sha?: string,
    includeBranch = true,
  ): Promise<void> {
    await this.#request(
      "PUT",
      `repos/${this.#repositoryPath}/contents/${encodedPath(filePath)}`,
      {
        message,
        content:
          typeof content === "string"
            ? Buffer.from(content, "utf8").toString("base64")
            : Buffer.from(content).toString("base64"),
        ...(includeBranch ? { branch: this.#branch } : {}),
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
        "user-agent": "capture-reflect-mcp",
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
