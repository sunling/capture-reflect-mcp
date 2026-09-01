import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const SKILL_NAMES = ["capture-records", "review-records", "recall-records"] as const;
const SKILL_URI_PREFIX = "skill://log-reflect/";

const skillResourceSchema = z.object({
  uri: z.string(),
  digest: z.string(),
});

const skillSchema = z.object({
  uri: z.string(),
  frontmatter: z.record(z.string(), z.string()),
  resources: z.array(skillResourceSchema),
});

export interface SkillCatalogEntry {
  uri: string;
  frontmatter: Record<string, string>;
  resources: Array<{ uri: string; digest: string }>;
  content: string;
}

function skillPath(name: string): string {
  const candidates = [
    path.join(process.cwd(), "skills", name, "SKILL.md"),
    fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)),
    fileURLToPath(new URL(`../../skills/${name}/SKILL.md`, import.meta.url)),
  ];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Unable to locate the bundled ${name} Skill.`);
  return found;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("Skill is missing YAML frontmatter.");

  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`Unsupported Skill frontmatter line: ${line}`);
    frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error("Skill frontmatter must include name and description.");
  }
  return frontmatter;
}

export function loadSkillCatalog(): SkillCatalogEntry[] {
  return SKILL_NAMES.map((name) => {
    const content = readFileSync(skillPath(name), "utf8");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.name !== name) {
      throw new Error(`Skill directory ${name} does not match frontmatter name ${frontmatter.name}.`);
    }
    const uri = `${SKILL_URI_PREFIX}${name}/SKILL.md`;
    return {
      uri,
      frontmatter,
      resources: [
        {
          uri,
          digest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
        },
      ],
      content,
    };
  });
}

export function registerSkills(server: McpServer): void {
  const catalog = loadSkillCatalog();
  const byUri = new Map(catalog.map((skill) => [skill.uri, skill]));
  const publicSkill = ({ content: _content, ...skill }: SkillCatalogEntry) => skill;

  server.server.registerCapabilities({
    extensions: { "io.modelcontextprotocol/skills": {} },
  });

  server.server.setRequestHandler(
    "skills/list",
    {
      params: z.object({ cursor: z.string().optional() }),
      result: z.object({ skills: z.array(skillSchema), nextCursor: z.string().optional() }),
    },
    async ({ cursor }) => ({
      skills: cursor ? [] : catalog.map(publicSkill),
    }),
  );

  server.server.setRequestHandler(
    "skills/get",
    {
      params: z.object({ uri: z.string() }),
      result: z.object({ skill: skillSchema }),
    },
    async ({ uri }) => {
      const skill = byUri.get(uri);
      if (!skill) throw new Error(`Unknown Skill URI: ${uri}`);
      return { skill: publicSkill(skill) };
    },
  );

  for (const skill of catalog) {
    server.registerResource(
      skill.frontmatter.name!,
      skill.uri,
      {
        title: skill.frontmatter.name!,
        description: skill.frontmatter.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: skill.content }],
      }),
    );
  }
}
