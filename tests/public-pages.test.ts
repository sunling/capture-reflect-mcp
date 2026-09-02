import { describe, expect, it } from "vitest";
import publicPages from "../netlify/functions/public-pages.js";

describe("public pages", () => {
  it("presents Log & Reflect as a trustworthy product", async () => {
    const response = publicPages(new Request("https://api.bysunling.com/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Keep what happened.");
    expect(body).toContain("Your repository is the source of truth.");
    expect(body).toContain("avatars.githubusercontent.com/in/4795662");
    expect(body).toContain("#155b43");
  });

  it("serves branded support and policy pages", async () => {
    for (const path of ["/support", "/privacy", "/terms"]) {
      const response = publicPages(new Request(`https://api.bysunling.com${path}`));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("Log &amp; Reflect");
      expect(body).toContain("Your words, in your repository.");
    }
  });

  it("returns 404 for unknown public paths", () => {
    const response = publicPages(new Request("https://api.bysunling.com/unknown"));
    expect(response.status).toBe(404);
  });
});
