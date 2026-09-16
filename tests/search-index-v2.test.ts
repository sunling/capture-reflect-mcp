import { describe, expect, it } from "vitest";
import {
  buildBloom,
  buildShardedIndex,
  manifestMatchesRecords,
  shardKeyForPath,
} from "../src/storage/search-index.js";

describe("search index v2 sharding", () => {
  it("groups dated records by type and year and hashes legacy paths", () => {
    expect(shardKeyForPath("journals/2026/202609/20260916-test.md"))
      .toBe("journals/2026");
    expect(shardKeyForPath("notes/2024/202401/note.md"))
      .toBe("notes/2024");
    expect(shardKeyForPath("notes/_legacy/topic/note.md"))
      .toMatch(/^notes\/_legacy\/[0-9a-f]$/);
  });

  it("builds a manifest whose shard digests validate the repository tree", () => {
    const entries = {
      "journals/2026/202609/20260916-test.md": {
        sha: "journal-sha",
        bloom: buildBloom("journal content"),
      },
      "notes/2026/202609/20260916-note.md": {
        sha: "note-sha",
        bloom: buildBloom("note content"),
      },
    };
    const index = buildShardedIndex(entries);

    expect(index.shards.size).toBe(2);
    expect(manifestMatchesRecords(index.manifest, [
      { path: "journals/2026/202609/20260916-test.md", sha: "journal-sha" },
      { path: "notes/2026/202609/20260916-note.md", sha: "note-sha" },
    ])).toBe(true);
    expect(manifestMatchesRecords(index.manifest, [
      { path: "journals/2026/202609/20260916-test.md", sha: "changed" },
      { path: "notes/2026/202609/20260916-note.md", sha: "note-sha" },
    ])).toBe(false);
  });
});
