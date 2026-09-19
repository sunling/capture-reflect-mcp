import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSkillCatalog } from "../src/skill-catalog.js";

describe("Skill catalog", () => {
  it("publishes the four bundled Skills with stable resource digests", () => {
    const skills = loadSkillCatalog();

    expect(skills.map(({ frontmatter }) => frontmatter.name)).toEqual([
      "capture-record",
      "review-records",
      "recall-records",
      "bubble-breaker",
    ]);
    expect(skills).toHaveLength(4);
    for (const skill of skills) {
      expect(skill.resources).toEqual([
        {
          uri: skill.uri,
          digest: `sha256:${createHash("sha256").update(skill.content).digest("hex")}`,
        },
      ]);
    }
  });

  it("instructs clients to honor explicit intent and clarify only genuine ambiguity", () => {
    const capture = loadSkillCatalog().find((skill) => skill.frontmatter.name === "capture-record")!;
    expect(capture.content).toContain("Honor an explicit request to journal or write a diary");
    expect(capture.content).toContain("Today, I would like to journal for today. In the morning");
    expect(capture.content).toContain("Honor an explicit request to save a note");
    expect(capture.content).toContain("Only if the type is genuinely ambiguous");
    expect(capture.content).toContain("Do not call any write tool or default to notes while waiting");
    expect(capture.content).toContain("without any substantive entry is not journal content");
  });
});
