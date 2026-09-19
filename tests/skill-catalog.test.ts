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

  it("routes capture versus help before choosing a folder without repetitive questions", () => {
    const capture = loadSkillCatalog().find((skill) => skill.frontmatter.name === "capture-record")!;
    expect(capture.content).toContain("Choose the action first, with minimal friction");
    expect(capture.content).toContain("treat subsequent fragments as journal material until they change direction");
    expect(capture.content).toContain("Do not retrieve records just because their narrative mentions existing notes");
    expect(capture.content).toContain("ask **one brief action question** before calling read or write tools");
    expect(capture.content).toContain("Once answered, proceed with the pending text and do not ask again");
    expect(capture.content).toContain("Never require users to select a folder on every capture");
  });

  it("limits Bubble Breaker routing to deliberate exploration, not demo advice", () => {
    const bubble = loadSkillCatalog().find((skill) => skill.frontmatter.name === "bubble-breaker")!;
    expect(bubble.frontmatter.description).toContain("intentional information-bubble exploration");
    expect(bubble.content).toContain("Only use this skill when the user deliberately asks");
    expect(bubble.content).toContain("How can I present my tool and demo in 5 mins?");
    expect(bubble.content).toContain("Do not trigger Bubble Breaker for generic brainstorming");
    expect(bubble.content).toContain("Do not apply these defaults to unrelated conversations");
  });
});
