import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import {
  assertDate,
  assertKeyword,
  attachmentMarkdown,
  buildJournalFragment,
  buildNoteDocument,
  compactDate,
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

async function walkMarkdownFiles(directory: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return [walkMarkdownFiles(entryPath)];
      if (entry.isFile() && entry.name.endsWith(".md")) return [Promise.resolve([entryPath])];
      return [];
    }),
  );
  return nested.flat();
}

export class LocalRecordsStore implements RecordsStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  async captureJournal(
    input: CaptureJournalInput,
  ): Promise<CaptureResult> {
    assertDate(input.date);
    assertKeyword(input.keyword);

    const compact = compactDate(input.date);
    const year = compact.slice(0, 4);
    const month = compact.slice(0, 6);
    const directory = path.join(this.#root, "daily", "journals", year, month);
    await fs.mkdir(directory, { recursive: true });

    const existing = (await fs.readdir(directory)).filter(
      (name) => name.startsWith(compact) && name.endsWith(".md"),
    );
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
      const filePath = path.join(directory, existing[0]!);
      await fs.appendFile(filePath, `\n${fragment}`, "utf8");
      return {
        path: path.relative(this.#root, filePath),
        action: "appended",
        attachmentPaths: storedAttachments.map((attachment) => attachment.path),
      };
    }

    const filePath = path.join(directory, journalFileName(input));
    await fs.writeFile(filePath, fragment, { encoding: "utf8", flag: "wx" });
    return {
      path: path.relative(this.#root, filePath),
      action: "created",
      attachmentPaths: storedAttachments.map((attachment) => attachment.path),
    };
  }

  async captureNote(
    note: CaptureNoteInput,
  ): Promise<CaptureResult & { action: "created" }> {
    assertDate(note.date);
    assertKeyword(note.keyword);

    const compact = compactDate(note.date);
    const directory = path.join(this.#root, noteDirectory(note.date));
    await fs.mkdir(directory, { recursive: true });

    const filePath = path.join(directory, `${compact}-${note.keyword}.md`);
    try {
      await fs.access(filePath);
      throw new Error(`A note already exists at ${path.relative(this.#root, filePath)}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const storedAttachments = await this.#writeAttachments(
      "note",
      note.date,
      note.keyword,
      note.attachments ?? [],
    );
    const imageMarkdown = attachmentMarkdown(storedAttachments);
    const document = buildNoteDocument({
      ...note,
      content: imageMarkdown ? `${note.content.trim()}\n\n${imageMarkdown}` : note.content,
    });

    await fs.writeFile(filePath, document, { encoding: "utf8", flag: "wx" });
    return {
      path: path.relative(this.#root, filePath),
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

    const compact = compactDate(date);
    const year = compact.slice(0, 4);
    const month = compact.slice(0, 6);
    const category = type === "journal" ? "journals" : "notes";
    const directory = path.join(this.#root, "daily", category, year, month, "images");
    await fs.mkdir(directory, { recursive: true });

    const stored: Array<{ path: string; alt: string }> = [];
    for (const [index, attachment] of attachments.entries()) {
      let suffix = index + 1;
      while (true) {
        const filePath = path.join(
          directory,
          `${compact}-${keyword}-${suffix}.${attachment.extension}`,
        );
        try {
          await fs.writeFile(filePath, Buffer.from(attachment.data), { flag: "wx" });
          stored.push({ path: path.relative(this.#root, filePath), alt: attachment.alt });
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
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
    const roots = [
      ...(requested.has("journal")
        ? [{ type: "journal" as const, path: path.join(this.#root, "daily", "journals") }]
        : []),
      ...(requested.has("note")
        ? [{ type: "note" as const, path: path.join(this.#root, "daily", "notes") }]
        : []),
    ];

    const records = (
      await Promise.all(
        roots.map(async (root) => {
          const files = await walkMarkdownFiles(root.path);
          return Promise.all(
            files.map(async (filePath): Promise<StoredRecord | undefined> => {
              const date = recordDateFromPath(filePath);
              if (!date || date < options.from || date > options.to) return undefined;
              return {
                path: path.relative(this.#root, filePath),
                date,
                type: root.type,
                content: await fs.readFile(filePath, "utf8"),
              };
            }),
          );
        }),
      )
    )
      .flat()
      .filter((record): record is StoredRecord => record !== undefined);

    return records.sort((a, b) => a.path.localeCompare(b.path));
  }

  async searchRecords(options: {
    query: string;
    from?: string;
    to?: string;
    types?: RecordType[];
    limit?: number;
  }): Promise<Array<StoredRecord & { excerpts: string[] }>> {
    const from = options.from ?? "0001-01-01";
    const to = options.to ?? "9999-12-31";
    const query = options.query.trim().toLocaleLowerCase();
    if (!query) throw new Error("query must not be empty.");

    const records = await this.getRecords({
      from,
      to,
      ...(options.types ? { types: options.types } : {}),
    });
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    return records
      .flatMap((record) => {
        const lines = record.content.split("\n");
        const excerpts = lines
          .filter((line) => line.toLocaleLowerCase().includes(query))
          .slice(0, 3);
        return excerpts.length > 0 ? [{ ...record, excerpts }] : [];
      })
      .slice(0, limit);
  }
}
