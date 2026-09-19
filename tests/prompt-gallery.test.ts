import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gallery = readFileSync(new URL("../PROMPTS.md", import.meta.url), "utf8");

const workflows = [
  "Journal", "Note", "Edit", "Search", "Read", "Connections", "Review",
  "Save review", "Bubble Breaker", "Setup", "Switch account",
];

describe("prompt gallery", () => {
  it("provides five short, distinct examples for each workflow", () => {
    const rows = gallery.split("\n").filter((line) => /^\| (?!Workflow|---)/.test(line));
    expect(rows).toHaveLength(workflows.length);
    const seen = new Set<string>();
    for (const [i, row] of rows.entries()) {
      const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
      expect(cells[0]).toMatch(new RegExp(`^${workflows[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`));
      const examples = cells[1].split(" · ");
      expect(examples).toHaveLength(5);
      for (const example of examples) {
        expect(example.length).toBeLessThanOrEqual(64);
        expect(seen.has(example)).toBe(false);
        seen.add(example);
      }
    }
    expect(seen.size).toBe(55);
  });

  it("includes signature starters and explains their boundaries", () => {
    for (const prompt of ["Captain's log.", "Note to self...", "Review my week.", "Break my bubble."]) {
      expect(gallery).toContain(prompt);
    }
    expect(gallery).toContain("not save an empty record");
    expect(gallery).toContain("How can I present my demo?");
    expect(gallery).toContain("Metadata tests alone cannot prove");
  });
});
