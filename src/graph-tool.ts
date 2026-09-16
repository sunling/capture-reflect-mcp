import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { getRecordConnections } from "./storage/record-graph.js";
import type { RecordsStore } from "./storage/records-store.js";

const node = z.object({
  path: z.string(),
  date: z.string(),
  type: z.enum(["journal", "note", "review"]),
  title: z.string(),
  id: z.string().optional(),
});
const edge = node.extend({ label: z.string() });

export function registerGraphTool(server: McpServer, store: RecordsStore): void {
  server.registerTool(
    "get_record_connections",
    {
      title: "Read a record's Markdown connections",
      description:
        "Read outgoing links, backlinks and broken references for an exact record path returned by search/read, or an optional stable ID from Markdown frontmatter. This tool derives connections directly from the original Markdown files, including legacy records without IDs; it does not create relationships or write an index. Only standard relative Markdown links are connections. Reading the complete repository may be slower in a large vault.",
      inputSchema: z.object({
        path: z.string().min(1).optional().describe("Exact repository-relative Markdown path obtained from search/read. Provide either path or id."),
        id: z.string().min(1).optional().describe("Optional id: value from record frontmatter. Provide either id or path."),
      }).refine(({ path, id }) => Boolean(path) !== Boolean(id), "Provide exactly one of path or id."),
      outputSchema: z.object({
        record: node,
        outgoing: z.array(edge),
        backlinks: z.array(edge),
        unresolved: z.array(z.object({ label: z.string(), target: z.string() })),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ path, id }) => {
      const records = await store.getRecords({
        from: "0001-01-01", to: "9999-12-31", types: ["journal", "note", "review"],
      });
      const result = getRecordConnections(records, { ...(path ? { path } : {}), ...(id ? { id } : {}) });
      return {
        structuredContent: result,
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
