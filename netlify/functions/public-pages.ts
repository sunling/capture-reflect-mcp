import type { Config } from "@netlify/functions";
import { brandPage, escapeHtml } from "./_shared/brand-page.js";

const legalPages: Record<string, { title: string; body: string }> = {
  "/privacy": {
    title: "Privacy Policy",
    body: "Capture & Reflect processes your ChatGPT identity and encrypted GitHub authorization only to read and write the repository you select. Your journal entries, notes, and images are sent directly to GitHub and are not stored in our database. Reviews are generated in chat and are not written to your repository in this version. You may revoke access by uninstalling the GitHub App. Contact support for deletion requests.",
  },
  "/terms": {
    title: "Terms of Service",
    body: "You retain ownership of your records. You are responsible for the repository and content you choose to store. The service is provided as-is and may be updated or discontinued. Do not use it for unlawful content.",
  },
};

function homePage(): Response {
  return brandPage({
    title: "A quiet place to capture and reflect",
    layout: "wide",
    cacheControl: "public, max-age=300",
    body: `
      <section class="hero">
        <div>
          <div class="eyebrow">Private by design</div>
          <h1>Keep what happened.<br><em>Return to what matters.</em></h1>
          <p class="lede">Capture &amp; Reflect helps you capture journal entries, notes, and images in conversation—then revisit them with the language and perspective that feel natural to you.</p>
          <div class="actions">
            <a class="button" href="https://github.com/sunling/capture-reflect-mcp">View the open-source project</a>
            <a class="button secondary" href="/support">Get support</a>
          </div>
        </div>
        <div class="paper" aria-label="A handwritten reflection">
          <div class="paper-date">A small note to my future self</div>
          <div class="paper-copy">I want to remember <span>how this felt</span>, not only what happened.</div>
          <div class="paper-eye" aria-hidden="true"></div>
        </div>
      </section>
      <section class="principles" aria-label="How Capture and Reflect works">
        <article class="principle"><div class="number">01</div><h2>Capture</h2><p>Capture naturally in any language. A journal entry, a passing note, an idea, or an image can all belong.</p></article>
        <article class="principle"><div class="number">02</div><h2>Revisit</h2><p>Your records stay as readable files in GitHub, organized so both you and AI can find them again.</p></article>
        <article class="principle"><div class="number">03</div><h2>Reflect</h2><p>Look back across days and seasons to notice patterns, changes, and what still deserves attention.</p></article>
      </section>
      <section class="trust">
        <h2>Your repository is the source of truth.</h2>
        <p>Capture &amp; Reflect writes your content and images directly to the GitHub repository you choose. It stores only the encrypted connection details needed to reach that repository—not a second copy of your writing.</p>
      </section>
    `,
  });
}

function supportPage(): Response {
  return brandPage({
    title: "Support",
    body: `<section class="reading-card"><div class="eyebrow">We are here to help</div><h1>Support</h1><p>For help, bug reports, account disconnection, or data deletion requests, open an issue in the <a href="https://github.com/sunling/capture-reflect-mcp/issues">Capture &amp; Reflect GitHub repository</a>.</p></section>`,
  });
}

export default (request: Request): Response => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/") return homePage();
  if (pathname === "/support") return supportPage();
  const page = legalPages[pathname];
  if (!page) return new Response("Not found", { status: 404 });
  return brandPage({
    title: page.title,
    body: `<section class="reading-card"><div class="eyebrow">Capture &amp; Reflect</div><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.body)}</p></section>`,
  });
};

export const config: Config = { path: ["/", "/privacy", "/terms", "/support"] };
