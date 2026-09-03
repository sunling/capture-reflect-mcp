import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSkillCatalog } from "../src/skill-catalog.js";

describe("Skill catalog", () => {
  it("publishes the three bundled Skills with stable resource digests", () => {
    const skills = loadSkillCatalog();

    expect(skills.map(({ frontmatter }) => frontmatter.name)).toEqual([
      "capture-record",
      "review-records",
      "recall-records",
    ]);
    expect(skills).toHaveLength(3);
    for (const skill of skills) {
      expect(skill.resources).toEqual([
        {
          uri: skill.uri,
          digest: `sha256:${createHash("sha256").update(skill.content).digest("hex")}`,
        },
      ]);
    }
  });
});
