// Minimal accessible page shell shared by all spikes. Semantic HTML, system fonts,
// CSS variables as design tokens, WCAG AA contrast in both themes.
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--card:#fff;--line:#e7e5e4;--accent:#7c3aed;--ok:#15803d;--warn:#b45309;--bad:#b91c1c;--r:12px;--s:1rem}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#fafaf9;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#a78bfa;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:56rem;margin:0 auto;padding:calc(var(--s)*2) var(--s)}
h1{font-size:1.75rem;margin:0 0 .25rem}p.lead{color:var(--muted);margin:0 0 calc(var(--s)*1.5)}
section{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--s);margin-bottom:var(--s)}
label{display:block;font-weight:600;margin-bottom:.25rem}
input,textarea{width:100%;font:inherit;padding:.625rem .75rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button{font:inherit;font-weight:600;min-height:44px;padding:.5rem 1rem;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;margin-top:.75rem}
button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.875rem;background:var(--bg);padding:.75rem;border-radius:8px;border:1px solid var(--line)}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
a{color:var(--accent);text-underline-offset:2px}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
