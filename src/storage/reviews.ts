import { assertDate, assertKeyword, compactDate } from "./record-utils.js";
import type { RecordsStore, SaveReviewInput } from "./records-store.js";

export class ReviewSourceValidationError extends Error {
  readonly stage = "review_source_validation";

  constructor(
    readonly code: "REVIEW_SOURCE_PATH_INVALID" | "REVIEW_SOURCES_NOT_IN_RANGE",
    readonly from: string,
    readonly to: string,
    readonly sourceCount: number,
    readonly invalidPaths: string[],
  ) {
    const reason = code === "REVIEW_SOURCE_PATH_INVALID"
      ? "Invalid review source path"
      : "Review source not found in the reviewed range";
    super(`${code}: ${reason} (${from} to ${to}): ${JSON.stringify(invalidPaths)}. ` +
      "Copy sourcePaths exactly from the records returned for this range; use repository-relative paths, not Markdown links. " +
      "Keep historical comparison citations in the body. Check the intended period and sources before retrying; do not silently drop evidence or widen the range. Reuse the review body if it remains accurate.");
    this.name = "ReviewSourceValidationError";
  }
}

export async function prepareReview(store: RecordsStore, input: SaveReviewInput) {
  assertDate(input.date);
  assertDate(input.from);
  assertDate(input.to);
  assertKeyword(input.keyword);
  if (input.from > input.to) throw new Error("from must be on or before to.");
  if (!input.title.trim() || !input.content.trim()) throw new Error("Review title and content must not be empty.");
  if (input.sourcePaths.length === 0) throw new Error("A review must reference at least one reviewed entry.");
  const sources = [...new Set(input.sourcePaths)];
  const invalidPaths = sources.filter((source) =>
    !/^(journals|notes)\/.+\.md$/.test(source) ||
    source.split("/").some((part) => !part || part === "." || part === "..") ||
    /[\\\u0000-\u001f\u007f]/.test(source),
  );
  if (invalidPaths.length > 0) {
    throw new ReviewSourceValidationError("REVIEW_SOURCE_PATH_INVALID", input.from, input.to, sources.length, invalidPaths);
  }
  const records = await store.getRecords({ from: input.from, to: input.to, types: ["journal", "note"] });
  const available = new Set(records.map((record) => record.path));
  const unavailablePaths = sources.filter((source) => !available.has(source));
  if (unavailablePaths.length > 0) {
    throw new ReviewSourceValidationError("REVIEW_SOURCES_NOT_IN_RANGE", input.from, input.to, sources.length, unavailablePaths);
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
