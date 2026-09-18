import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  CaptureJournalInput,
  CaptureNoteInput,
  NoteSource,
  RelatedRecordEntry,
} from "./records-store.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_KEYWORD_PATTERN = /^[\p{L}\p{M}\p{N}_-]{1,40}$/u;

/** A new identity is stored in Markdown, never inferred from a mutable path or Git SHA. */
export function createRecordId(): string {
  return `cr_${randomUUID()}`;
}

export function assertDate(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date: ${date}. Expected YYYY-MM-DD.`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid calendar date: ${date}.`);
  }
}

export function assertKeyword(keyword: string): void {
  if (!SAFE_KEYWORD_PATTERN.test(keyword)) {
    throw new Error(
      "keyword must be 1-40 letters, combining marks, numbers, underscores, or hyphens, with no spaces or slashes.",
    );
  }
}

export function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

export function isRangeReviewPath(filePath: string): boolean {
  return filePath.startsWith("reviews/") && /^\d{8}-\d{8}-.+\.md$/.test(path.basename(filePath));
}

export function recordDateFromPath(filePath: string, content?: string): string | undefined {
  if (isRangeReviewPath(filePath)) {
    // Range filenames describe the reviewed period, not the save date.
    const frontmatter = content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const savedDate = frontmatter?.match(/^date: *["']?(\d{4}-\d{2}-\d{2})["']? *\r?$/m)?.[1];
    if (!savedDate) return undefined;
    try { assertDate(savedDate); } catch { return undefined; }
    return savedDate;
  }
  const match = path.basename(filePath).match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function journalDirectory(date: string): string {
  const compact = compactDate(date);
  return `journals/${compact.slice(0, 4)}/${compact.slice(0, 6)}`;
}

export function noteDirectory(date: string): string {
  const compact = compactDate(date);
  return `notes/${compact.slice(0, 4)}/${compact.slice(0, 6)}`;
}

/** One file per day. Fragment titles, language and topics belong inside the journal. */
export function journalFileName<T extends { date: string }>(input: T): string {
  return `${compactDate(input.date)}.md`;
}

/** Only prepend this day-level heading and ID on creation; appends preserve existing identity. */
export function journalHeading(input: CaptureJournalInput): string {
  // Derive the weekday from the record's date, not the server clock or timezone.
  const day = new Date(`${input.date}T12:00:00Z`);
  const text = `${input.title}\n${input.content}`;
  const locale = /[ぁ-ゟ゠-ヿ]/u.test(text)
    ? "ja-JP"
    : /[가-힣]/u.test(text)
      ? "ko-KR"
      : /\p{Script=Han}/u.test(text)
        ? "zh-CN"
        : "en-US";
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  }).format(day);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(day);
  const shortWeekday = locale === "zh-CN" ? weekday.replace(/^星期/, "周") : weekday;
  return `---\nid: ${createRecordId()}\n---\n\n# ${date} · ${shortWeekday}\n\n`;
}

export function buildJournalFragment(input: CaptureJournalInput): string {
  return `### ${input.title.trim()}\n\n${input.content.trim()}\n`;
}

export function attachmentMarkdown(
  attachments: Array<{ path: string; alt: string }>,
): string {
  if (attachments.length === 0) return "";
  return attachments
    .map(({ path: filePath, alt }) => `![${alt.replaceAll("]", "\\]")}](images/${path.basename(filePath)})`)
    .join("\n\n");
}

type NoteLocale = "en" | "zh" | "ja" | "ko";

const NOTE_LABELS = {
  en: {
    originalNote: "Original note",
    source: "Source",
    sourceTitle: "Title",
    sourceAuthor: "Author / source",
    sourceType: "Type",
    sourceLink: "Link",
    relatedRecords: "Related records",
    relatedJournals: "Related journal entries",
    relatedNotes: "Related notes",
    journal: "Journal",
    note: "Note",
    possibleConnection: "Possible connection (AI)",
    furtherReflection: "Further reflection (AI)",
    possibleActions: "Possible actions (AI)",
  },
  zh: {
    originalNote: "原始笔记",
    source: "来源",
    sourceTitle: "标题",
    sourceAuthor: "作者 / 来源",
    sourceType: "类型",
    sourceLink: "链接",
    relatedRecords: "相关记录",
    relatedJournals: "相关日记",
    relatedNotes: "相关笔记",
    journal: "日记",
    note: "笔记",
    possibleConnection: "可能的关联（AI）",
    furtherReflection: "进一步思考（AI）",
    possibleActions: "可能的行动方向（AI）",
  },
  ja: {
    originalNote: "元のメモ",
    source: "出典",
    sourceTitle: "タイトル",
    sourceAuthor: "著者 / 出典",
    sourceType: "種類",
    sourceLink: "リンク",
    relatedRecords: "関連する記録",
    relatedJournals: "関連する日記",
    relatedNotes: "関連するメモ",
    journal: "日記",
    note: "メモ",
    possibleConnection: "考えられる関連（AI）",
    furtherReflection: "さらなる考察（AI）",
    possibleActions: "考えられる行動（AI）",
  },
  ko: {
    originalNote: "원본 메모",
    source: "출처",
    sourceTitle: "제목",
    sourceAuthor: "저자 / 출처",
    sourceType: "유형",
    sourceLink: "링크",
    relatedRecords: "관련 기록",
    relatedJournals: "관련 일기",
    relatedNotes: "관련 메모",
    journal: "일기",
    note: "메모",
    possibleConnection: "가능한 연관성(AI)",
    furtherReflection: "추가 성찰(AI)",
    possibleActions: "가능한 행동(AI)",
  },
} as const;

function noteLocale(note: CaptureNoteInput): NoteLocale {
  const text = `${note.title}\n${note.originalNote}`;
  if (/[ぁ-ゟ゠-ヿ]/u.test(text)) return "ja";
  if (/[가-힣]/u.test(text)) return "ko";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  return "en";
}

function markdownSource(source: NoteSource, locale: NoteLocale): string {
  const labels = NOTE_LABELS[locale];
  const separator = locale === "zh" || locale === "ja" ? "：" : ":";
  const lines: string[] = [];
  if (source.title) {
    const title = source.url ? `[${source.title.trim()}](${source.url.trim()})` : source.title.trim();
    lines.push(`- **${labels.sourceTitle}${separator}** ${title}`);
  }
  if (source.author) lines.push(`- **${labels.sourceAuthor}${separator}** ${source.author.trim()}`);
  if (source.type) lines.push(`- **${labels.sourceType}${separator}** ${source.type.trim()}`);
  if (source.url && !source.title) lines.push(`- **${labels.sourceLink}${separator}** ${source.url.trim()}`);
  return lines.join("\n");
}

function markdownRelatedEntries(entries: RelatedRecordEntry[], locale: NoteLocale): string {
  const labels = NOTE_LABELS[locale];
  const separator = locale === "zh" || locale === "ja" ? "：" : ":";
  const groups = ["journal", "note"] as const;
  return groups.flatMap((type) => {
    const matches = entries.filter((entry) => entry.type === type);
    if (matches.length === 0) return [];
    const heading = type === "journal" ? labels.relatedJournals : labels.relatedNotes;
    const typeLabel = type === "journal" ? labels.journal : labels.note;
    const body = matches.map((entry) => [
      `- [${entry.date} · ${typeLabel}](../../../${entry.path.trim().split("/").map(encodeURIComponent).join("/")})`,
      `  > ${entry.excerpt.trim().replaceAll("\n", "\n  > ")}`,
      "",
      `  **${labels.possibleConnection}${separator}** ${entry.possibleConnection.trim()}`,
    ].join("\n")).join("\n\n");
    return [`### ${heading}\n\n${body}`];
  }).join("\n\n");
}

function markdownActions(actions: string[]): string {
  return actions.map((action) => `- ${action.trim().replaceAll("\n", "\n  ")}`).join("\n");
}

function assertStructuredNote(note: CaptureNoteInput): void {
  if (!note.originalNote.trim()) throw new Error("originalNote must not be blank.");
  if ((note.relatedEntries?.length ?? 0) > 3) throw new Error("relatedEntries supports at most three records.");
  for (const entry of note.relatedEntries ?? []) {
    assertDate(entry.date);
    const segments = entry.path.split("/");
    const expectedRoot = entry.type === "journal" ? "journals" : "notes";
    if (segments[0] !== expectedRoot || segments.some((segment) => !segment || segment === "." || segment === "..") || !entry.path.endsWith(".md")) {
      throw new Error(`Invalid related ${entry.type} path: ${entry.path}.`);
    }
    if (!entry.excerpt.trim() || !entry.possibleConnection.trim()) {
      throw new Error("Related entries require an excerpt and possibleConnection.");
    }
  }
  if ((note.possibleActions?.length ?? 0) > 5 || note.possibleActions?.some((action) => !action.trim())) {
    throw new Error("possibleActions supports up to five non-blank suggestions.");
  }
}

export function buildNoteDocument(note: CaptureNoteInput): string {
  assertStructuredNote(note);
  const tags = note.tags?.filter(Boolean).slice(0, 3) ?? [];
  const locale = noteLocale(note);
  const labels = NOTE_LABELS[locale];
  const frontmatter = [
    "---",
    `id: ${createRecordId()}`,
    `title: ${JSON.stringify(note.title.trim())}`,
    `date: ${note.date}`,
    ...(tags.length > 0 ? ["tags:", ...tags.map((tag) => `  - ${JSON.stringify(tag)}`)] : []),
    "---",
  ].join("\n");
  const sections = [
    `## ${labels.originalNote}\n\n${note.originalNote}`,
  ];
  if (note.source) {
    const source = markdownSource(note.source, locale);
    if (source) sections.push(`## ${labels.source}\n\n${source}`);
  }
  if (note.relatedEntries?.length) {
    sections.push(`## ${labels.relatedRecords}\n\n${markdownRelatedEntries(note.relatedEntries, locale)}`);
  }
  if (note.furtherReflection?.trim()) {
    sections.push(`## ${labels.furtherReflection}\n\n${note.furtherReflection.trim()}`);
  }
  if (note.possibleActions?.some((action) => action.trim())) {
    sections.push(`## ${labels.possibleActions}\n\n${markdownActions(note.possibleActions.filter((action) => action.trim()))}`);
  }
  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}
