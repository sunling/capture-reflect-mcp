import type { Config } from "@netlify/functions";

export default (): Response => {
  const token = Netlify.env.get("OPENAI_APPS_CHALLENGE");
  return token
    ? new Response(token, { headers: { "content-type": "text/plain; charset=utf-8" } })
    : Response.json({ error: "Challenge token is not configured" }, { status: 404 });
};

export const config: Config = { path: "/.well-known/openai-apps-challenge" };
