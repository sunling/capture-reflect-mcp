import path from "node:path";
import type { CaptureJournalInput, CaptureNoteInput } from "./records-store.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_KEYWORD_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

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
      "keyword must be 1-40 letters, numbers, underscores, or hyphens, with no spaces or slashes.",
    );
  }
}

export function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

export function recordDateFromPath(filePath: string): string | undefined {
  const match = path.basename(filePath).match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function journalDirectory(date: string): string {
  const compact = compactDate(date);
  return `daily/journal/${compact.slice(0, 4)}/${compact.slice(0, 6)}`;
}

export function noteDirectory(date: string): string {
  const compact = compactDate(date);
  return `daily/note/${compact.slice(0, 4)}/${compact.slice(0, 6)}`;
}

export function journalFileName(input: CaptureJournalInput): string {
  const compact = compactDate(input.date);
  const weekday = WEEKDAYS[new Date(`${input.date}T00:00:00Z`).getUTCDay()];
  return `${compact}-${weekday}-${input.keyword}.md`;
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

export function buildNoteDocument(note: CaptureNoteInput): string {
  const tags = note.tags?.filter(Boolean).slice(0, 3) ?? [];
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(note.title.trim())}`,
    `date: ${note.date}`,
    ...(note.source ? [`source: ${JSON.stringify(note.source.trim())}`] : []),
    ...(tags.length > 0 ? ["tags:", ...tags.map((tag) => `  - ${JSON.stringify(tag)}`)] : []),
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${note.content.trim()}\n`;
}
