import { describe, expect, it } from "vitest";
import { assertKeyword, journalFileName } from "../src/storage/record-utils.js";

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
