const logoUrl = "https://avatars.githubusercontent.com/in/4795662?s=192&v=4";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type BrandPageOptions = {
  title: string;
  body: string;
  layout?: "wide" | "reading";
  status?: number;
  cacheControl?: string;
};

export function brandPage(options: BrandPageOptions): Response {
  const layout = options.layout ?? "reading";
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#155b43">
  <meta name="description" content="Capture what matters now and return to it when you have space, stored in your own GitHub repository.">
  <title>${escapeHtml(options.title)} · Capture &amp; Reflect</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #173b2f;
      --green: #155b43;
      --green-dark: #0d4934;
      --green-soft: #e8f0eb;
      --orange: #f6a43c;
      --paper: #fffdf8;
      --canvas: #f5f0e6;
      --muted: #65736c;
      --line: rgba(21,91,67,.16);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 12% 8%, rgba(246,164,60,.11), transparent 24rem),
        radial-gradient(circle at 90% 34%, rgba(21,91,67,.08), transparent 28rem),
        var(--canvas);
      color: var(--ink);
      font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: var(--green); text-underline-offset: 3px; }
    .page { width: min(100% - 40px, ${layout === "wide" ? "1120px" : "760px"}); margin: 0 auto; }
    .site-header { display: flex; align-items: center; justify-content: space-between; padding: 28px 0; }
    .brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; font-weight: 760; letter-spacing: -.02em; }
    .brand img { width: 52px; height: 52px; border-radius: 16px; box-shadow: 0 5px 18px rgba(23,59,47,.12); }
    .brand-note { color: var(--muted); font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    main { padding: 32px 0 76px; }
    .hero { display: grid; grid-template-columns: 1.15fr .85fr; gap: 72px; align-items: center; padding: 44px 0 84px; }
    .eyebrow { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 18px; color: var(--green); font-size: 13px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
    .eyebrow::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--orange); box-shadow: 12px 5px 0 -2px rgba(246,164,60,.55); }
    h1, h2 { font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif; }
    h1 { margin: 0; max-width: 720px; font-size: clamp(42px, 7vw, 76px); line-height: .99; letter-spacing: -.045em; font-weight: 540; }
    h1 em { color: var(--green); font-style: italic; font-weight: 500; }
    h2 { margin: 0 0 12px; font-size: 27px; line-height: 1.2; font-weight: 570; letter-spacing: -.025em; }
    .lede { max-width: 650px; margin: 24px 0 0; color: var(--muted); font-size: 19px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
    .button { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; padding: 0 19px; border: 1px solid var(--green); border-radius: 999px; background: var(--green); color: white; text-decoration: none; font-weight: 720; transition: transform .15s, background .15s; }
    .button:hover { transform: translateY(-1px); background: var(--green-dark); }
    .button.secondary { background: transparent; color: var(--green); }
    .paper { position: relative; min-height: 390px; padding: 46px 42px; overflow: hidden; transform: rotate(1.5deg); border: 1px solid rgba(21,91,67,.12); border-radius: 4px 18px 7px 15px; background: repeating-linear-gradient(var(--paper) 0 38px, #dce7e0 39px, var(--paper) 40px); box-shadow: 0 22px 45px rgba(53,61,53,.12); }
    .paper::before { content: ""; position: absolute; top: 0; bottom: 0; left: 28px; width: 1px; background: rgba(246,164,60,.42); }
    .paper-date { color: var(--green); font: italic 18px ui-serif, Georgia, serif; }
    .paper-copy { margin-top: 42px; font: 25px/1.58 ui-serif, Georgia, serif; }
    .paper-copy span { color: var(--green); }
    .paper-eye { margin: 32px auto 0; width: 92px; height: 44px; border: 3px solid var(--green); border-radius: 65% 10% 65% 10%; transform: rotate(45deg); }
    .paper-eye::after { content: ""; display: block; width: 17px; height: 17px; margin: 10px auto; border-radius: 50%; background: var(--green); }
    .principles { display: grid; grid-template-columns: repeat(3,1fr); gap: 22px; padding: 8px 0 64px; }
    .principle { padding-top: 18px; border-top: 2px solid var(--line); }
    .number { color: var(--orange); font-size: 12px; font-weight: 800; letter-spacing: .08em; }
    .principle h2 { margin-top: 8px; }
    .principle p { margin: 0; color: var(--muted); }
    .trust { display: grid; grid-template-columns: .8fr 1.2fr; gap: 40px; padding: 38px; border: 1px solid var(--line); border-radius: 28px 7px 28px 7px; background: rgba(255,253,248,.78); }
    .trust p { margin: 0; color: var(--muted); font-size: 17px; }
    .reading-card, .setup-card { padding: clamp(26px, 6vw, 54px); border: 1px solid var(--line); border-radius: 28px 7px 28px 7px; background: rgba(255,253,248,.92); box-shadow: 0 18px 45px rgba(53,61,53,.08); }
    .reading-card h1, .setup-card h1 { font-size: clamp(36px, 7vw, 56px); }
    .reading-card p { color: var(--muted); font-size: 17px; }
    .field { margin-top: 22px; }
    label { display: block; margin-bottom: 7px; font-size: 14px; font-weight: 750; }
    .hint { margin: 7px 0 0; color: var(--muted); font-size: 13px; }
    select, input { width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid #cfd8d2; border-radius: 10px; outline: none; background: white; color: var(--ink); font: inherit; }
    select:focus, input:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(21,91,67,.12); }
    button { width: 100%; min-height: 50px; margin-top: 28px; border: 0; border-radius: 999px; background: var(--green); color: white; cursor: pointer; font: inherit; font-weight: 750; }
    button:hover { background: var(--green-dark); }
    .privacy-note { display: flex; gap: 11px; margin-top: 20px; padding: 14px 16px; border-radius: 12px; background: var(--green-soft); color: var(--muted); font-size: 13px; }
    .privacy-note > span { color: var(--orange); }
    .success { display: grid; width: 50px; height: 50px; place-items: center; margin-bottom: 18px; border-radius: 50%; background: var(--green-soft); color: var(--green); font-size: 24px; font-weight: 800; }
    .repo { color: var(--ink); font-weight: 750; word-break: break-word; }
    .site-footer { display: flex; justify-content: space-between; gap: 24px; padding: 25px 0 36px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
    .site-footer nav { display: flex; gap: 18px; }
    .site-footer a { color: inherit; }
    @media (max-width: 760px) {
      .brand-note { display: none; }
      main { padding-top: 12px; }
      .hero { grid-template-columns: 1fr; gap: 48px; padding: 25px 0 64px; }
      .paper { min-height: 330px; }
      .principles, .trust { grid-template-columns: 1fr; }
      .principles { gap: 30px; }
      .site-footer { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="site-header">
      <a class="brand" href="/">
        <img src="${logoUrl}" alt="" width="52" height="52" referrerpolicy="no-referrer">
        <span>Capture &amp; Reflect</span>
      </a>
      <span class="brand-note">Capture · Revisit · Reflect</span>
    </header>
    <main>${options.body}</main>
    <footer class="site-footer">
      <span>Your words, in your repository.</span>
      <nav><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    </footer>
  </div>
</body>
</html>`, {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": options.cacheControl ?? "no-store",
      "content-security-policy": "default-src 'none'; img-src https://avatars.githubusercontent.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
