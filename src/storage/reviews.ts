import { assertDate, assertKeyword, compactDate } from "./record-utils.js";
import type { RecordsStore, SaveReviewInput } from "./records-store.js";

export async function prepareReview(store: RecordsStore, input: SaveReviewInput) {
  assertDate(input.date);
  assertDate(input.from);
  assertDate(input.to);
  assertKeyword(input.keyword);
  if (input.from > input.to) throw new Error("from must be on or before to.");
  if (!input.title.trim() || !input.content.trim()) throw new Error("Review title and content must not be empty.");
  if (input.sourcePaths.length === 0) throw new Error("A review must reference at least one reviewed entry.");
  const sources = [...new Set(input.sourcePaths)];
  for (const source of sources) {
    if (!/^(journals|notes)\/.+\.md$/.test(source) ||
        source.split("/").some((part) => !part || part === "." || part === "..") ||
        /[\\\u0000-\u001f\u007f]/.test(source)) {
      throw new Error(`Invalid review source path: ${source}`);
    }
  }
  const records = await store.getRecords({ from: input.from, to: input.to, types: ["journal", "note"] });
  const available = new Set(records.map((record) => record.path));
  for (const source of sources) {
    if (!available.has(source)) throw new Error(`Review source not found in the reviewed range: ${source}`);
  }
  const date = compactDate(input.date);
  const reviewPath = `reviews/${date.slice(0, 4)}/${date.slice(0, 6)}/${date}-${input.keyword}.md`;
  const metadata = [
    "---", `title: ${JSON.stringify(input.title.trim())}`, `date: ${input.date}`,
    `from: ${input.from}`, `to: ${input.to}`, "type: review", "source_paths:",
    ...sources.map((source) => `  - ${JSON.stringify(source)}`), "---",
  ].join("\n");
  // Keep a linked source inventory even when the client uses localized/custom headings.
  const links = sources.map((source) =>
    `- [${source.replace(/[\[\]\\]/g, "\\$&")}](../../../${source.split("/").map(encodeURIComponent).join("/")})`,
  ).join("\n");
  return { path: reviewPath, content: `${metadata}\n\n${input.content.trim()}\n\n---\n\n${links}\n` };
}
