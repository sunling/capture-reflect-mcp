#!/usr/bin/env node
/** Repair review references AFTER moving a journal/note file or directory in a local Git checkout.
 * This never moves records or changes the hosted user's repository; --write is explicit.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  return "Usage: node scripts/migrate-review-sources.mjs --repo /path/to/records [--from journals/old --to journals/new] [--write]\n" +
    "Without --write, preview proposed review edits and audit the resulting links. With no mapping, only audit existing references.";
}

function repoPath(value) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\0") || value.startsWith("/") ||
      value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe repository-relative path: ${value}`);
  }
  if (!/^(journals|notes)\/.+/.test(value)) throw new Error(`Only journal/note paths are supported: ${value}`);
  return value;
}

function matches(candidate, from) {
  return candidate === from || candidate.startsWith(`${from}/`);
}

function renamed(candidate, from, to) {
  return from && matches(candidate, from) ? `${to}${candidate.slice(from.length)}` : candidate;
}

function decodeLinkTarget(url, reviewPath) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\/\/)/i.test(url)) return null;
  const [pathname, suffix = ""] = url.match(/^([^?#]*)([?#][\s\S]*)?$/)?.slice(1) ?? [];
  if (!pathname || !/\.md$/i.test(pathname)) return null;
  let decoded;
  try { decoded = pathname.split("/").map(decodeURIComponent).join("/"); }
  catch { throw new Error(`Invalid URL escaping in ${reviewPath}: ${url}`); }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(reviewPath), decoded));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new Error(`Link escapes the repository in ${reviewPath}: ${url}`);
  }
  return { resolved, suffix };
}

function relativeUrl(reviewPath, target, suffix) {
  const relative = path.posix.relative(path.posix.dirname(reviewPath), target);
  return relative.split("/").map((component) => component === ".." || component === "."
    ? component : encodeURIComponent(component)).join("/") + suffix;
}

function transformReview(reviewPath, input, from, to) {
  const sourcePaths = [];
  const links = [];
  const leading = input.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  let metadata = leading?.[0] ?? "";
  let body = input.slice(metadata.length);
  let inSources = false;
  metadata = metadata.split(/(?<=\n)/).map((line) => {
    if (/^source_paths:\s*$/.test(line.trimEnd())) { inSources = true; return line; }
    if (!inSources) return line;
    if (/^(?:---|\S)/.test(line)) { inSources = false; return line; }
    const item = line.match(/^(\s+-\s+)("(?:\\.|[^"\\])*")(\r?\n?)$/);
    if (!item) {
      if (line.trim()) throw new Error(`Unsupported source_paths YAML in ${reviewPath}: ${line.trim()}`);
      return line;
    }
    const source = repoPath(JSON.parse(item[2]));
    const next = renamed(source, from, to);
    sourcePaths.push(next);
    return `${item[1]}${JSON.stringify(next)}${item[3]}`;
  }).join("");
  function remapLink(url) {
    const target = decodeLinkTarget(url, reviewPath);
    if (!target) return url;
    const next = renamed(target.resolved, from, to);
    links.push(next);
    return next === target.resolved ? url : relativeUrl(reviewPath, next, target.suffix);
  }
  // Ordinary inline Markdown links, including GitHub's percent-encoded Unicode paths.
  body = body.replace(/(!?\[[^\]\r\n]*\]\()([^\s)]+)(\))/g, (_, before, url, after) =>
    `${before}${remapLink(url)}${after}`);
  // Reference-style link definitions such as [entry]: ../../../journals/2026/.../record.md
  body = body.replace(/^(\s{0,3}\[[^\]\r\n]+\]:\s*)(\S+)([^\r\n]*)$/gm, (_, before, url, after) =>
    `${before}${remapLink(url)}${after}`);
  // Legacy reviews sometimes cite raw repository paths inside backticks.
  body = body.replace(/`((?:journals|notes)\/[^`\r\n]+\.md)`/g, (_, source) => `\`${renamed(source, from, to)}\``);
  return { content: metadata + body, sourcePaths, links };
}

async function reviewFiles(root) {
  const all = [];
  async function visit(relative) {
    let entries;
    try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) all.push(child);
    }
  }
  await visit("reviews");
  return all.sort();
}

export async function migrateReviewSources(root, { from, to, write = false } = {}) {
  if ((from === undefined) !== (to === undefined)) throw new Error("--from and --to must be provided together.");
  if (from !== undefined) {
    repoPath(from); repoPath(to);
    if (from === to) throw new Error("--from and --to must differ.");
    if (from.split("/")[0] !== to.split("/")[0]) throw new Error("Moving between journals/ and notes/ requires a separate record migration.");
  }
  if (write && from === undefined) throw new Error("--write requires --from and --to.");
  const absoluteRoot = path.resolve(root);
  const changes = [];
  const broken = [];
  for (const review of await reviewFiles(absoluteRoot)) {
    const original = await fs.readFile(path.join(absoluteRoot, review), "utf8");
    const transformed = transformReview(review, original, from, to);
    for (const source of new Set([...transformed.sourcePaths, ...transformed.links])) {
      // Check actual target existence, including after a move: the script never moves it for you.
      try {
        const stat = await fs.stat(path.join(absoluteRoot, source));
        if (!stat.isFile()) broken.push(`${review} -> ${source} (not a file)`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        broken.push(`${review} -> ${source} (missing)`);
      }
    }
    if (transformed.content !== original) changes.push({ review, content: transformed.content });
  }
  // Validate the entire batch before touching any review files.
  if (broken.length) return { reviewed: (await reviewFiles(absoluteRoot)).length, changes: changes.map(({ review }) => review), broken, written: false };
  if (write) {
    for (const { review, content } of changes) {
      const filename = path.join(absoluteRoot, review);
      const temp = `${filename}.migrate-${process.pid}.tmp`;
      try { await fs.writeFile(temp, content, { flag: "wx" }); await fs.rename(temp, filename); }
      finally { await fs.rm(temp, { force: true }); }
    }
  }
  return { reviewed: (await reviewFiles(absoluteRoot)).length, changes: changes.map(({ review }) => review), broken, written: write };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = process.argv.slice(2);
    const values = new Map();
    for (let index = 0; index < args.length; index++) {
      const name = args[index];
      if (name === "--write") values.set(name, true);
      else if (["--repo", "--from", "--to"].includes(name) && args[index + 1] && !args[index + 1].startsWith("--")) values.set(name, args[++index]);
      else throw new Error(usage());
    }
    if (!values.has("--repo")) throw new Error(usage());
    const report = await migrateReviewSources(values.get("--repo"), {
      from: values.get("--from"), to: values.get("--to"), write: Boolean(values.get("--write")),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.broken.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
