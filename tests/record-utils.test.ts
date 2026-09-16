import { describe, expect, it } from "vitest";
import { assertKeyword, journalFileName, recordDateFromPath } from "../src/storage/record-utils.js";

describe("review save dates", () => {
  const rangePath = "reviews/2027/202701/20261225-20261231-计划被打乱之后.md";
  it("uses metadata for range filenames across years and preserves legacy filename dates", () => {
    expect(recordDateFromPath(rangePath, "---\ndate: 2027-01-02\n---\nBody")).toBe("2027-01-02");
    expect(recordDateFromPath("reviews/2026/202609/20260915-from-trip-to-action.md")).toBe("2026-09-15");
    expect(recordDateFromPath("notes/2026/202609/20260905-20260911-topic.md")).toBe("2026-09-05");
  });
  it.each([undefined, "Body\ndate: 2027-01-02", "---\ndate: 2027-02-30\n---\nBody"])(
    "does not mistake the reviewed start date for a missing or invalid save date", (content) => {
      expect(recordDateFromPath(rangePath, content)).toBeUndefined();
    },
  );
});

describe("multilingual filenames", () => {
  it.each(["हिन्दी", "บันทึก", "cafe\u0301", "تَأَمُّل", "散步", "reflection"])(
    "accepts keyword %s without rewriting it",
    (keyword) => {
      expect(() => assertKeyword(keyword)).not.toThrow();
      expect(journalFileName({ date: "2026-08-31", title: keyword, keyword, content: keyword }))
        .toBe(`20260831-${keyword}.md`);
    },
  );

  it.each(["../escape", "a/b", "a\\b", "two words", "", "a".repeat(41)])(
    "rejects invalid keyword %s",
    (keyword) => expect(() => assertKeyword(keyword)).toThrow(),
  );
});
