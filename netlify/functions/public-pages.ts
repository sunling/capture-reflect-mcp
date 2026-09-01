import type { Config } from "@netlify/functions";

const pages: Record<string, { title: string; body: string }> = {
  "/": { title: "Log & Reflect", body: "A private journaling MCP that stores records in a GitHub repository selected by you." },
  "/privacy": { title: "Privacy Policy", body: "Log & Reflect processes your ChatGPT identity and encrypted GitHub authorization only to read and write the repository you select. Journal content is sent directly to GitHub and is not stored in our database. You may revoke access by uninstalling the GitHub App. Contact support for deletion requests." },
  "/terms": { title: "Terms of Service", body: "You retain ownership of your records. You are responsible for the repository and content you choose to store. The service is provided as-is and may be updated or discontinued. Do not use it for unlawful content." },
  "/support": { title: "Support", body: "For help, bug reports, account disconnection, or data deletion requests, open an issue at github.com/sunling/log-reflect-mcp/issues." },
};

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export default (request: Request): Response => {
  const page = pages[new URL(request.url).pathname];
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(page.title)}</title><style>body{font:18px/1.65 system-ui;max-width:720px;margin:10vh auto;padding:0 24px;color:#25231f}a{color:#395f45}</style><main><h1>${escape(page.title)}</h1><p>${escape(page.body)}</p><p><a href="/support">Support</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p></main></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
};

export const config: Config = { path: ["/", "/privacy", "/terms", "/support"] };
