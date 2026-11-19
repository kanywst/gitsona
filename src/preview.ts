import type { Profile } from "./analyze.ts";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Just enough Markdown for the block gitsona writes: headings, paragraphs, lists, links, bold, hard breaks, raw HTML. */
export function miniMarkdown(md: string): string {
  const inline = (s: string) =>
    s
      .replace(/\\([\\[\]`*_<>])/g, "\uE000$1")
      .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/ {2}$/gm, "<br>")
      .replace(/\\$/gm, "<br>")
      .replace(/\uE000(.)/g, (_, c) => esc(c));
  const blocks = md.split(/\n{2,}/);
  return blocks
    .map((b) => {
      const t = b.trim();
      if (!t) return "";
      if (t.startsWith("<!--")) return "";
      if (t.startsWith("### ")) return `<h3>${inline(t.slice(4))}</h3>`;
      if (/^- /m.test(t) && t.split("\n").every((l) => l.startsWith("- "))) {
        return `<ul>${t
          .split("\n")
          .map((l) => `<li>${inline(l.slice(2))}</li>`)
          .join("")}</ul>`;
      }
      if (t.startsWith("<")) return inline(t);
      return `<p>${inline(t).replace(/\n/g, " ")}</p>`;
    })
    .join("\n");
}

/** A local page that frames the README like a GitHub profile, with a light/dark switch. */
export function previewHtml(p: Profile, readme: string): string {
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gitsona preview: @${esc(p.login)}</title>
<style>
:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--link:#0969da;color-scheme:light}
:root[data-theme=dark]{--bg:#0d1117;--fg:#f0f6fc;--muted:#9198a1;--border:#3d444d;--link:#4493f8;color-scheme:dark}
@media (prefers-color-scheme:dark){:root[data-theme=auto]{--bg:#0d1117;--fg:#f0f6fc;--muted:#9198a1;--border:#3d444d;--link:#4493f8;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:24px 16px;display:grid;grid-template-columns:296px 1fr;gap:24px}
@media (max-width:900px){.wrap{grid-template-columns:1fr}}
.side img{width:100%;max-width:296px;border-radius:50%;border:1px solid var(--border)}
.side h1{margin:12px 0 0;font-size:24px;line-height:1.25}.side .login{color:var(--muted);font-size:20px;font-weight:300}
.box{border:1px solid var(--border);border-radius:6px;padding:24px}
.box .file{font-size:12px;color:var(--muted);margin:-8px 0 16px}
.box h3{font-size:1.25em;margin:24px 0 16px;font-weight:600}
.box img{max-width:100%}
.box a{color:var(--link);text-decoration:none}
.box sub{color:var(--muted)}
code{font-size:85%;padding:.2em .4em;border-radius:6px;background:color-mix(in srgb,var(--fg) 8%,transparent)}
.bar{position:fixed;top:12px;right:12px;display:flex;gap:4px}
.bar button{font:12px system-ui;padding:4px 10px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:6px;cursor:pointer}
.bar button[aria-pressed=true]{border-color:var(--link);color:var(--link)}
</style>
</head>
<body>
<div class="bar" role="group" aria-label="Theme">
<button data-t="auto">System</button><button data-t="light">Light</button><button data-t="dark">Dark</button>
</div>
<div class="wrap">
<aside class="side"><img src="${esc(p.avatarUrl)}" alt=""><h1>${esc(p.displayName)}</h1><div class="login">${esc(p.login)}</div></aside>
<main class="box"><div class="file">${esc(p.login)} / README.md</div>
${miniMarkdown(readme)}
</main>
</div>
<script>
const root=document.documentElement;
function sync(){
  const t=root.dataset.theme;
  const dark=t==="dark"||(t==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll("picture").forEach(p=>{
    const s=p.querySelector("source"),i=p.querySelector("img");
    i.dataset.light??=i.getAttribute("src");
    i.src=dark?s.getAttribute("srcset"):i.dataset.light;
  });
  document.querySelectorAll(".bar button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.t===t)));
}
document.querySelectorAll(".bar button").forEach(b=>b.onclick=()=>{root.dataset.theme=b.dataset.t;sync()});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",sync);sync();
</script>
</body>
</html>
`;
}
