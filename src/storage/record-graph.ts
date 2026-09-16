import path from "node:path";
import type { StoredRecord } from "./records-store.js";

/** No proprietary graph database: all edges come from portable Markdown links. */
export interface GraphNode {
  path: string;
  date: string;
  type: StoredRecord["type"];
  title: string;
  id?: string;
}

export interface GraphEdge extends GraphNode {
  label: string;
}

export interface RecordConnections {
  record: GraphNode;
  outgoing: GraphEdge[];
  backlinks: GraphEdge[];
  unresolved: Array<{ label: string; target: string }>;
}

const ROOTS = /^(?:journals|notes|reviews)\//;
const ID = /^[A-Za-z0-9_-]{6,80}$/;

function metadata(content: string): string | undefined {
  return content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
}

export function recordId(content: string): string | undefined {
  const value = metadata(content)?.match(/^id:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*$/m);
  const id = value?.[1] ?? value?.[2] ?? value?.[3];
  return id && ID.test(id) ? id : undefined;
}

function recordTitle(record: StoredRecord): string {
  const frontmatter = metadata(record.content);
  const rawTitle = frontmatter?.match(/^title:\s*(.+)\s*$/m)?.[1]?.trim();
  if (rawTitle) {
    try {
      const decoded: unknown = JSON.parse(rawTitle);
      if (typeof decoded === "string") return decoded;
    } catch { /* Plain YAML scalar. */ }
    return rawTitle.replace(/^['"]|['"]$/g, "");
  }
  return record.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? path.posix.basename(record.path, ".md");
}

function asNode(record: StoredRecord): GraphNode {
  const id = recordId(record.content);
  return { path: record.path, date: record.date, type: record.type, title: recordTitle(record), ...(id ? { id } : {}) };
}

/** Exclude fenced and inline code: example links must not become graph edges. */
function prose(content: string): string {
  let fence: { marker: string; length: number } | undefined;
  return content.split(/\r?\n/).map((line) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1]![0]!;
      if (!fence) fence = { marker, length: match[1]!.length };
      else if (marker === fence.marker && match[1]!.length >= fence.length) fence = undefined;
      return "";
    }
    if (fence) return "";
    return line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, "");
  }).join("\n");
}

interface Link { label: string; target: string }

/** Standard inline and reference-style Markdown links, never images or external URLs. */
export function markdownLinks(content: string): Link[] {
  const text = prose(content);
  const definitions = new Map<string, string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    definitions.set(match[1]!.trim().toLocaleLowerCase(), match[2] ?? match[3]!);
  }
  const links: Link[] = [];
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    links.push({ label: match[1]!, target: match[2] ?? match[3]! });
  }
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const target = definitions.get((match[2] || match[1]!).trim().toLocaleLowerCase());
    if (target) links.push({ label: match[1]!, target });
  }
  return links;
}

/** Convert a Markdown link to a repository-relative file, without escaping the vault. */
export function linkPath(origin: string, target: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\\)/i.test(target)) return undefined;
  const raw = target.split(/[?#]/, 1)[0];
  if (!raw || !/\.md$/i.test(raw)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return undefined; }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(origin), decoded));
  if (!ROOTS.test(resolved) || resolved.includes("\\") || !resolved.endsWith(".md")) return undefined;
  return resolved;
}

/** Derives backlinks on demand; missing IDs are supported and never written implicitly. */
export function getRecordConnections(
  records: StoredRecord[],
  locator: { path?: string; id?: string },
): RecordConnections {
  if (Boolean(locator.path) === Boolean(locator.id)) throw new Error("Supply exactly one record path or ID.");
  const byPath = new Map(records.map((record) => [record.path, record]));
  const matches = locator.path
    ? records.filter((record) => record.path === locator.path)
    : records.filter((record) => recordId(record.content) === locator.id);
  if (matches.length !== 1) {
    throw new Error(matches.length > 1 ? "Duplicate record ID; fix the conflicting Markdown frontmatter." : "Record not found.");
  }
  const selected = matches[0]!;
  const outgoing: GraphEdge[] = [];
  const backlinks: GraphEdge[] = [];
  const unresolved: RecordConnections["unresolved"] = [];
  const seenOutgoing = new Set<string>();
  const seenBacklinks = new Set<string>();
  for (const record of records) {
    for (const link of markdownLinks(record.content)) {
      const target = linkPath(record.path, link.target);
      if (!target) continue;
      if (record.path === selected.path) {
        const linked = byPath.get(target);
        if (!linked) unresolved.push({ label: link.label, target: link.target });
        else if (!seenOutgoing.has(target)) {
          outgoing.push({ ...asNode(linked), label: link.label });
          seenOutgoing.add(target);
        }
      }
      if (target === selected.path && record.path !== selected.path && !seenBacklinks.has(record.path)) {
        backlinks.push({ ...asNode(record), label: link.label });
        seenBacklinks.add(record.path);
      }
    }
  }
  const sortByPath = (left: GraphEdge, right: GraphEdge) => left.path.localeCompare(right.path);
  return { record: asNode(selected), outgoing: outgoing.sort(sortByPath), backlinks: backlinks.sort(sortByPath), unresolved };
}
