// Sensei: an agent that sabotages a real Linux machine and coaches you while you fix it.
// This is the CONTROL app (runs on shubu-sensei). The training machine is a separate Sprite
// that can reach only the Ollama connector; it never sees GitHub or the Sprites token.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { page, esc } from "../core/html.ts";
import { notify } from "../core/notify.ts";
import { ask } from "../core/llm.ts";
import { gw } from "../core/gateway.ts";
import * as sprites from "../core/sprites.ts";
import { CATALOG, AREAS, PLANNED, byId, type Challenge } from "../dojo/catalog.ts";

const DOJO = process.env.HG_DOJO_SPRITE ?? "dojo-1";
const GOLDEN = process.env.HG_DOJO_GOLDEN ?? "v5";
const TERM = process.env.HG_DOJO_TERM ?? "";
const PIN = process.env.HG_PIN ?? "";
const JOURNAL_REPO = process.env.HG_JOURNAL_REPO ?? "";
const STATE_DIR = process.env.HG_STATE_DIR ?? "/home/sprite/sensei";
const SECRET = process.env.HG_COOKIE_SECRET ?? randomBytes(32).toString("hex");
const PORT = Number(process.env.PORT ?? 8080);
mkdirSync(STATE_DIR, { recursive: true });

// ---------- state ----------
interface Attempt { id: string; startedAt: number; endedAt?: number; hints: string[]; result?: "solved" | "gave-up"; stars?: number }
interface State { level: 1 | 2 | 3; history: Attempt[]; current: Attempt | null; phase: "idle" | "preparing" | "active" | "solved" | "error"; message: string }
const STATE_FILE = `${STATE_DIR}/state.json`;
const load = (): State => existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { level: 1, history: [], current: null, phase: "idle", message: "" };
const save = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));

function nextChallenge(s: State): Challenge {
  const solved = new Set(s.history.filter((a) => a.result === "solved").map((a) => a.id));
  const pool = CATALOG.filter((c) => !solved.has(c.id));
  const atLevel = pool.filter((c) => c.level === s.level);
  const pick = atLevel[0] ?? pool.sort((a, b) => a.level - b.level)[0] ?? CATALOG[Math.floor(Math.random() * CATALOG.length)];
  return pick;
}

function stars(seconds: number, hints: number, level: number): number {
  const par = level * 300; // 5 min per level
  return Math.max(1, 3 - hints - (seconds > par ? 1 : 0));
}

// ---------- training machine control ----------
let busy = false;

async function startChallenge() {
  const s = load();
  if (busy) return;
  busy = true;
  const c = nextChallenge(s);
  s.current = { id: c.id, startedAt: 0, hints: [] };
  s.phase = "preparing"; s.message = "Resetting the training machine…"; save(s);
  try {
    await sprites.restore(DOJO, GOLDEN);
    await new Promise((r) => setTimeout(r, 2500)); // let shop + terminal boot
    const r = await sprites.run(DOJO, `~/dojo/challenges.sh break ${c.id} && sleep 2 && ! ~/dojo/challenges.sh check ${c.id}`, 60_000, true);
    if (r.code !== 0) throw new Error(`breakage did not take: ${r.out.slice(-200)}`);
    // Verify again in a separate step: anything the breakage started must outlive its one-shot service.
    await new Promise((res) => setTimeout(res, 3000));
    const v = await sprites.run(DOJO, `! ~/dojo/challenges.sh check ${c.id}`, 30_000);
    if (v.code !== 0) throw new Error("the breakage healed itself — not starting the clock");
    await sprites.putService(DOJO, "watch", "bash", ["/home/sprite/dojo/watch.sh", c.id]);
    const s2 = load();
    s2.current = { id: c.id, startedAt: Date.now(), hints: [] };
    s2.phase = "active"; s2.message = ""; save(s2);
  } catch (e) {
    const s2 = load(); s2.phase = "error"; s2.message = `Could not prepare the challenge: ${(e as Error).message}`; save(s2);
  } finally { busy = false; }
}

async function pollFixed(): Promise<void> {
  const s = load();
  if (s.phase !== "active" || !s.current) return;
  const raw = await sprites.readFile(DOJO, "/var/tmp/sensei/status.json");
  if (!raw) return;
  let st: { challenge: string; fixed: boolean };
  try { st = JSON.parse(raw); } catch { return; }
  if (st.challenge !== s.current.id || !st.fixed) return;
  const c = byId(s.current.id)!;
  const a = s.current;
  a.endedAt = Date.now(); a.result = "solved";
  a.stars = stars((a.endedAt - a.startedAt) / 1000, a.hints.length, c.level);
  s.history.push(a); s.phase = "solved";
  // Adapt: a clean solve moves you up; needing every hint keeps you where you are.
  if (a.stars >= 2 && s.level < 3) s.level = (s.level + 1) as 1 | 2 | 3;
  save(s);
  const mins = Math.round((a.endedAt - a.startedAt) / 60000);
  notify(`Sensei: ${c.title} — solved`, `${"★".repeat(a.stars)}${"☆".repeat(3 - a.stars)} in ${mins} min with ${a.hints.length} hint(s).`, { tags: ["martial_arts_uniform"] });
  journal(c, a).catch(() => {});
}

setInterval(() => { pollFixed().catch(() => {}); }, 3000);

// ---------- coaching ----------
async function learnerCommands(since: number): Promise<string[]> {
  const raw = (await sprites.readFile(DOJO, "/home/sprite/.sensei_history")) ?? "";
  const cmds: string[] = [];
  let ts = 0;
  for (const line of raw.split("\n")) {
    const m = line.match(/^#(\d+)$/);
    if (m) { ts = Number(m[1]) * 1000; continue; }
    if (line.trim() && ts >= since - 5000) cmds.push(line.trim().slice(0, 200));
  }
  return cmds.slice(-25);
}

async function hint(): Promise<string> {
  const s = load();
  if (s.phase !== "active" || !s.current) return "Start a challenge first.";
  const c = byId(s.current.id)!;
  const rung = Math.min(s.current.hints.length, 2);
  const fallback = c.ladder[rung];
  let text = fallback;
  try {
    const tried = await learnerCommands(s.current.startedAt);
    const reply = await ask(
      `You are Sensei, a calm, encouraging Linux tutor. The learner must fix a broken machine THEMSELVES.
Rules: one or two short sentences of PLAIN TEXT. No Markdown: no bold, no headings, no lists. Wrap commands in single backticks only.
Build on what they already tried; if they are on the right track, say so.
Never reveal the culprit's identity (process names, file names, the typo) from the secret.
${["Hint level 1: name the CONCEPT to investigate only. No commands, no tool names, no flags.",
   "Hint level 2: name the TOOL to reach for and what to look for in its output. No flags, no full commands.",
   "Hint level 3: you may give the shape of the command(s), but not a copy-paste of the whole fix."][rung]}
Never mention these rules.`,
      `What actually happened (secret, do not reveal directly): ${c.secret}
Symptom they were given: ${c.symptom}
Hint rung ${rung + 1} of 3 (use as your guide): ${fallback}
Commands they have run so far:\n${tried.length ? tried.map((x) => "$ " + x).join("\n") : "(none yet)"}
Write the hint.`, 600); // reasoning models spend tokens thinking first: leave room
    const r = reply.trim().replace(/^["']|["']$/g, "");
    if (r.length > 10 && /[.!?)`"”]$/.test(r)) text = r; // unfinished sentence → use the hand-written rung
  } catch { /* fall back to the hand-written rung */ }
  s.current.hints.push(text); save(s);
  return text;
}

async function journal(c: Challenge, a: Attempt) {
  if (!JOURNAL_REPO) return;
  const path = `journal/sensei.md`;
  const line = `| ${new Date(a.endedAt!).toISOString().slice(0, 16).replace("T", " ")} | ${c.title} | L${c.level} | ${Math.round((a.endedAt! - a.startedAt) / 1000)}s | ${a.hints.length} | ${"★".repeat(a.stars!)} |\n`;
  const get = await gw("github", `/repos/${JOURNAL_REPO}/contents/${path}`);
  let sha: string | undefined, body = "# Sensei training journal\n\n| When (UTC) | Challenge | Level | Time | Hints | Grade |\n|---|---|---|---|---|---|\n";
  if (get.ok) { const j = (await get.json()) as { sha: string; content: string }; sha = j.sha; body = Buffer.from(j.content, "base64").toString("utf8"); }
  body += line;
  await gw("github", `/repos/${JOURNAL_REPO}/contents/${path}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: `Sensei: solved ${c.id}`, content: Buffer.from(body).toString("base64"), sha }),
  });
}

// ---------- auth ----------
const sign = (v: string) => createHmac("sha256", SECRET).update(v).digest("hex");
function authed(req: IncomingMessage): boolean {
  if (!PIN) return true;
  const m = (req.headers.cookie ?? "").match(/sensei=([a-f0-9]{64})/);
  return !!m && timingSafeEqual(Buffer.from(m[1]), Buffer.from(sign("ok")));
}
function pinOk(given: string) {
  const a = Buffer.from(given), b = Buffer.from(PIN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- views ----------
const CSS = `<style>
/* Full-viewport app shell: header, then a scrolling coach panel beside a terminal that fills the rest. */
html,body{height:100%}
main{max-width:none;margin:0;padding:0;display:grid;grid-template-rows:auto 1fr}
@media (min-width:56rem){main{height:100dvh}}
.top{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;padding:.75rem 1.25rem;border-bottom:1px solid var(--line)}
.top h1{font-size:1.25rem;margin:0}.top p{margin:0;color:var(--muted);font-size:.9375rem}
.layout{display:grid;grid-template-columns:1fr;grid-template-rows:auto 75dvh;min-height:0}
@media (min-width:56rem){.layout{grid-template-columns:minmax(20rem,26rem) 1fr;grid-template-rows:1fr}}
.layout>section{margin:0;border:0;border-radius:0;background:transparent}
.panel{padding:1.25rem;min-height:0}
@media (min-width:56rem){.panel{overflow-y:auto}}
@media (min-width:56rem){.layout>.panel{border-right:1px solid var(--line)}}
.layout>.termwrap{padding:0;background:#000}
.panel h2{margin:.5rem 0;font-size:1.25rem}
.panel h3{font-size:.8125rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:1.25rem 0 .5rem}
.panel p{margin:.5rem 0}
.termwrap{display:grid;grid-template-rows:1fr auto;min-height:0}
.term{width:100%;height:100%;border:0;background:#000;display:block}
.note{margin:0;padding:.375rem 1.25rem;font-size:.8125rem;color:var(--muted);border-top:1px solid var(--line)}
.badge{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:.125rem .5rem;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.badge.ok{color:var(--ok);border-color:currentColor}.badge.warn{color:var(--warn);border-color:currentColor}
.timer{font-variant-numeric:tabular-nums;font-size:1.75rem;font-weight:700;margin:.75rem 0}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
button.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
ol.hints{padding-left:1.25rem;margin:0;display:grid;gap:.625rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:.0625rem .375rem;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:.375rem;margin:.25rem 0 0;padding:0;list-style:none}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.login{max-width:28rem;margin:4rem auto;padding:0 1.25rem}
</style>`;

/** Plain text in, safe HTML out: escapes everything, then renders `commands` as code and drops stray Markdown. */
function rich(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^#+\s*/gm, "");
}

function login(msg = "") {
  return page("Sensei", `${CSS}<div class="login"><h1>Sensei</h1><p class="lead">Sensei breaks a real Linux machine. You fix it. Sensei coaches.</p>
<section><form method="post" action="/login"><label for="pin">PIN</label>
<input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
<button type="submit">Enter the dojo</button>${msg ? `<p class="bad" role="alert">${esc(msg)}</p>` : ""}</form></section></div>`);
}

function view(s: State): string {
  const c = s.current ? byId(s.current.id) : null;
  const solvedCount = s.history.filter((a) => a.result === "solved").length;
  let card = "";
  if (s.phase === "idle" || !c) {
    card = `<p>Level <strong>${s.level}</strong> · ${solvedCount} solved</p>
<p class="muted">Press start and Sensei will sabotage the training machine. Fix it in the terminal.</p>
<form method="post" action="/start"><button type="submit">Start a challenge</button></form>`;
  } else if (s.phase === "preparing") {
    card = `<p role="status" aria-live="polite">${esc(s.message || "Preparing…")}</p>`;
  } else if (s.phase === "error") {
    card = `<p class="bad" role="alert">${esc(s.message)}</p><form method="post" action="/start"><button type="submit">Try again</button></form>`;
  } else {
    const a = s.current!;
    const solved = s.phase === "solved";
    const gaveUp = a.result === "gave-up";
    card = `<p class="row"><span class="badge">Level ${c.level}</span>${solved ? `<span class="badge ${gaveUp ? "warn" : "ok"}">${gaveUp ? "Revealed" : "Solved"}</span>` : ""}</p>
<h2>${esc(c.title)}</h2>
<p>${rich(c.symptom)}</p>
${solved
  ? `${gaveUp
      ? `<p class="warn" role="status">No shame in it — here's what was going on.</p>`
      : `<p class="ok" role="status"><strong>${"★".repeat(a.stars ?? 1)}${"☆".repeat(3 - (a.stars ?? 1))}</strong> in ${Math.round(((a.endedAt ?? 0) - a.startedAt) / 1000)}s with ${a.hints.length} hint(s).</p>`}
     <h3>What happened</h3><p>${rich(c.secret)}</p>
     <h3>Lesson</h3><p>${rich(c.lesson)}</p>
     <h3>Your toolbox</h3><ul class="chips">${c.skills.map((k) => `<li><code>${esc(k)}</code></li>`).join("")}</ul>
     <form method="post" action="/start"><button type="submit">Next challenge</button></form>`
  : `<p class="timer" aria-label="Time elapsed"><span id="timer" data-start="${a.startedAt}">0:00</span></p>
     <div class="row"><button type="button" id="hint">Hint (${a.hints.length}/3)</button>
     <form method="post" action="/giveup"><button type="submit" class="secondary">Give up</button></form></div>
     <p id="status" class="muted" role="status" aria-live="polite">Sensei is watching. The moment it's fixed, you'll know.</p>`}
<h3 id="hints-h"${a.hints.length ? "" : " hidden"}>Hints</h3><ol class="hints" id="hints">${a.hints.map((h) => `<li>${rich(h)}</li>`).join("")}</ol>`;
  }
  return page("Sensei", `${CSS}
<header class="top"><h1><a href="/" style="color:inherit;text-decoration:none">Sensei</a></h1><p>Sensei breaks a real Linux machine. You fix it. Sensei coaches.</p><p style="margin-left:auto"><a href="/">Roadmap</a></p></header>
<div class="layout">
  <section class="panel" aria-labelledby="challenge-heading"><h2 id="challenge-heading" class="visually-hidden">Challenge</h2>${card}</section>
  <section class="termwrap" aria-labelledby="term-heading"><h2 id="term-heading" class="visually-hidden">Training machine terminal</h2>
    ${TERM ? `<iframe class="term" src="${esc(TERM)}" title="Terminal on the training machine"></iframe>` : `<p class="bad">Terminal not configured.</p>`}
    <p class="note">A real, isolated Linux machine (a Fly.io Sprite). Break anything: Sensei resets it from a snapshot in about 2 seconds.</p>
  </section>
</div>
<script>
(function(){
  const t = document.getElementById("timer");
  if (t) setInterval(() => { const s = Math.floor((Date.now() - Number(t.dataset.start)) / 1000); t.textContent = Math.floor(s/60) + ":" + String(s%60).padStart(2,"0"); }, 1000);
  const phase = ${JSON.stringify(s.phase)};
  if (phase === "preparing" || phase === "active") setInterval(async () => {
    try { const r = await fetch("/api/state"); const j = await r.json(); if (j.phase !== phase) location.reload(); } catch (e) {}
  }, 2500);
  const b = document.getElementById("hint");
  if (b) b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Thinking…";
    try { const r = await fetch("/hint", { method: "POST" }); const j = await r.json();
      const li = document.createElement("li"); li.innerHTML = j.html; document.getElementById("hints").appendChild(li);
      document.getElementById("hints-h").hidden = false;
      b.textContent = "Hint (" + j.count + "/3)"; b.disabled = j.count >= 3;
    } catch (e) { b.textContent = "Hint"; b.disabled = false; }
  });
})();
</script>`);
}

// ---------- landing page (public) ----------
const BELTS = ["", "White belt", "Green belt", "Black belt"] as const;
const LEVEL_NAME = ["", "Easy", "Medium", "Hard"] as const;

const LCSS = `<style>
main{max-width:none;padding:0}
.wrap{max-width:72rem;margin:0 auto;padding:0 1.25rem}
.lnav{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.25rem;max-width:72rem;margin:0 auto}
.lnav strong{font-size:1.125rem}
.hero{padding:3rem 1.25rem 2rem}
.hero h1{font-size:clamp(2rem,5vw,3.25rem);line-height:1.1;margin:0 0 1rem;max-width:20ch}
.hero p{font-size:1.125rem;color:var(--muted);max-width:60ch;margin:0 0 1.5rem}
.cta{display:inline-flex;align-items:center;min-height:44px;padding:.625rem 1.25rem;border-radius:8px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none}
.cta:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
section.band{padding:2.5rem 0;margin:0;background:transparent;border:0;border-top:1px solid var(--line);border-radius:0}
.band h2{font-size:1.5rem;margin:0 0 .5rem}
.band>.wrap>p.sub{color:var(--muted);margin:0 0 1.5rem;max-width:60ch}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))}
.grid.areas{grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))}
.tile{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:1.25rem;margin:0}
.tile h3{margin:0 0 .375rem;font-size:1.0625rem}
.tile p{margin:0;color:var(--muted)}
.step-n{display:inline-grid;place-items:center;width:2rem;height:2rem;border-radius:999px;background:var(--accent);color:#fff;font-weight:700;margin-bottom:.75rem}
.area h3{display:flex;justify-content:space-between;gap:.5rem;align-items:baseline;flex-wrap:wrap}
.area .count{font-size:.8125rem;color:var(--muted);font-weight:400}
.area ul{list-style:none;padding:0;margin:1rem 0 0;display:grid;gap:.625rem}
.area li{display:grid;grid-template-columns:1fr auto;gap:.25rem .75rem;align-items:start;padding-top:.625rem;border-top:1px solid var(--line)}
.area li .t{font-weight:600}
.area li .m{grid-column:1/-1;color:var(--muted);font-size:.875rem}
.pill{font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:.125rem .5rem;border-radius:999px;border:1px solid var(--line);white-space:nowrap;color:var(--muted)}
.pill.solved{color:var(--ok);border-color:currentColor}
.pill.next{color:var(--accent);border-color:currentColor}
.pill.soon{border-style:dashed}
.road{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}
.tile p.stat{font-size:2rem;font-weight:800;line-height:1.1;margin:.25rem 0;color:var(--fg)}
.tile p.label{font-size:.8125rem;text-transform:uppercase;letter-spacing:.05em}
.bar{height:.625rem;border-radius:999px;background:var(--line);overflow:hidden;margin:.75rem 0 .25rem}
.bar>span{display:block;height:100%;background:var(--ok)}
.chips{display:flex;flex-wrap:wrap;gap:.375rem;margin:.75rem 0 0;padding:0;list-style:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:.0625rem .375rem}
footer{padding:2rem 0 3rem;border-top:1px solid var(--line);color:var(--muted);font-size:.875rem}
footer strong{color:var(--fg)}
.hero p.powered{font-size:.9375rem;margin:1rem 0 0}
.powered a,footer a{color:var(--accent);text-underline-offset:2px}
</style>`;

function landing(s: State, signedIn: boolean): string {
  const solvedIds = new Set(s.history.filter((a) => a.result === "solved").map((a) => a.id));
  const best = new Map<string, number>();
  for (const a of s.history) if (a.result === "solved") best.set(a.id, Math.max(best.get(a.id) ?? 0, a.stars ?? 1));
  const next = s.phase === "active" && s.current ? byId(s.current.id) : nextChallenge(s);
  const total = CATALOG.length + PLANNED.length;
  const pct = Math.round((solvedIds.size / total) * 100);
  const learned = [...new Set(CATALOG.filter((c) => solvedIds.has(c.id)).flatMap((c) => c.skills))];
  const enter = "/dojo"; // the dojo asks for the PIN if needed
  void signedIn;

  const status = (id: string) => solvedIds.has(id)
    ? `<span class="pill solved">Solved ${"★".repeat(best.get(id) ?? 1)}</span>`
    : next?.id === id ? `<span class="pill next">Next up</span>` : `<span class="pill">Available</span>`;

  const areaTiles = AREAS.map((area) => {
    const live = CATALOG.filter((c) => c.area === area.name);
    const soon = PLANNED.filter((c) => c.area === area.name);
    const done = live.filter((c) => solvedIds.has(c.id)).length;
    return `<article class="tile area"><h3>${esc(area.name)} <span class="count">${done}/${live.length + soon.length} solved</span></h3>
<p>${esc(area.blurb)}</p>
<ul>${live.map((c) => `<li><span class="t">${esc(c.title)}</span>${status(c.id)}<span class="m">${LEVEL_NAME[c.level]} · ${rich(c.symptom)}</span></li>`).join("")}
${soon.map((c) => `<li><span class="t">${esc(c.title)}</span><span class="pill soon">Coming soon</span><span class="m">${LEVEL_NAME[c.level]} · ${esc(c.teaser)}</span></li>`).join("")}</ul></article>`;
  }).join("");

  return page("Sensei — learn Linux by fixing a real broken machine", `${LCSS}
<header class="lnav"><strong>Sensei</strong><a class="cta" href="${enter}">${solvedIds.size ? "Continue training" : "Start training"}</a></header>
<div class="wrap hero">
  <h1>Learn Linux by fixing a machine that's really broken.</h1>
  <p>Sensei is a personal training agent. It sabotages a real Linux server, then coaches you while you find and fix the problem in your browser. When you're done it resets the machine and picks your next challenge based on how you did.</p>
  <a class="cta" href="${enter}">${solvedIds.size ? "Continue training" : "Start your first challenge"}</a>
  <p class="powered">Powered by <a href="https://sprites.dev">Sprites.dev</a> (<a href="https://fly.io">Fly.io</a>)</p>
</div>

<section class="band" aria-labelledby="how"><div class="wrap">
  <h2 id="how">How it works</h2>
  <p class="sub">No videos and no multiple choice. A real machine, a real problem, and a coach who watches what you try.</p>
  <div class="grid">
    <article class="tile"><span class="step-n" aria-hidden="true">1</span><h3>Sensei breaks something</h3><p>A port gets stolen, a config gets a typo, a process starts eating every CPU. You only get the symptom.</p></article>
    <article class="tile"><span class="step-n" aria-hidden="true">2</span><h3>You fix it in a real terminal</h3><p>A full Linux shell in your browser, on an isolated machine. Nothing you do can hurt anything else.</p></article>
    <article class="tile"><span class="step-n" aria-hidden="true">3</span><h3>Sensei coaches</h3><p>Hints build on the commands you actually ran: first the idea, then the tool, then the shape of the command.</p></article>
    <article class="tile"><span class="step-n" aria-hidden="true">4</span><h3>Reset, level up, repeat</h3><p>It spots the fix within seconds, grades you, shows the toolbox you used, and restores the machine from a snapshot in about 2 seconds.</p></article>
  </div>
</div></section>

<section class="band" aria-labelledby="roadmap"><div class="wrap">
  <h2 id="roadmap">Your roadmap</h2>
  <p class="sub">What you've solved, what you've learned, and where Sensei is taking you next.</p>
  <div class="road">
    <article class="tile"><p class="label">Rank</p><p class="stat">${BELTS[s.level]}</p><p>Level ${s.level} of 3</p></article>
    <article class="tile"><p class="label">Progress</p><p class="stat">${solvedIds.size} / ${total}</p>
      <div class="bar" role="progressbar" aria-label="Challenges solved" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${solvedIds.size}"><span style="width:${pct}%"></span></div>
      <p>${PLANNED.length ? `${CATALOG.length} ready now, ${PLANNED.length} coming soon` : `All ${CATALOG.length} challenges ready`}</p></article>
    <article class="tile"><p class="label">Next up</p><p class="stat" style="font-size:1.25rem">${next ? esc(next.title) : "All done"}</p><p>${next ? `${LEVEL_NAME[next.level]} · ${esc(next.area)}` : "New challenges are on the way."}</p></article>
  </div>
  <article class="tile" style="margin-top:1rem"><h3>Skills you've used so far</h3>
    ${learned.length ? `<ul class="chips">${learned.map((k) => `<li><code>${esc(k)}</code></li>`).join("")}</ul>` : `<p>None yet. Solve your first challenge and the tools you used will show up here.</p>`}
  </article>
</div></section>

<section class="band" aria-labelledby="challenges"><div class="wrap">
  <h2 id="challenges">The challenges</h2>
  <p class="sub">Grouped by the skill they train. You see the symptom, never the answer, until you've fixed it.</p>
  <div class="grid areas">${areaTiles}</div>
</div></section>

<footer><div class="wrap"><strong>Powered by <a href="https://sprites.dev">Sprites.dev</a> (<a href="https://fly.io">Fly.io</a>).</strong> Every challenge happens on a real, isolated Linux machine that resets from a snapshot. Coaching uses an open-weight model through the Sprites Ollama connector; your training journal is committed to GitHub through the GitHub connector. No API keys live on any machine you can touch.</div></footer>`);
}

// ---------- http ----------
function send(res: ServerResponse, code: number, body: string, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) {
  res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...extra });
  res.end(body);
}
async function form(req: IncomingMessage) {
  let b = ""; for await (const ch of req) { b += ch; if (b.length > 2048) break; }
  return new URLSearchParams(b);
}
const redirect = (res: ServerResponse) => { res.writeHead(303, { location: "/dojo" }); res.end(); };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname === "/login") {
      const f = await form(req);
      if (!pinOk(f.get("pin") ?? "")) return send(res, 403, login("Wrong PIN."));
      res.writeHead(303, { location: "/dojo", "set-cookie": `sensei=${sign("ok")}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` });
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, landing(load(), authed(req)));
    if (!authed(req)) return send(res, 200, login());
    if (req.method === "GET" && url.pathname === "/dojo") return send(res, 200, view(load()));
    if (req.method === "GET" && url.pathname === "/api/state") { const s = load(); return send(res, 200, JSON.stringify({ phase: s.phase, level: s.level }), "application/json"); }
    if (req.method === "POST" && url.pathname === "/start") { startChallenge(); return redirect(res); }
    if (req.method === "POST" && url.pathname === "/hint") {
      const s = load();
      if ((s.current?.hints.length ?? 0) >= 3) return send(res, 200, JSON.stringify({ html: rich("That's all the hints. Solve it to see the lesson, or give up to see the answer."), count: 3 }), "application/json");
      const h = await hint();
      return send(res, 200, JSON.stringify({ html: rich(h), count: load().current?.hints.length ?? 0 }), "application/json");
    }
    if (req.method === "POST" && url.pathname === "/giveup") {
      const s = load();
      if (s.current && s.phase === "active") { s.current.endedAt = Date.now(); s.current.result = "gave-up"; s.history.push(s.current); s.phase = "solved"; s.current.stars = 0; save(s); }
      return redirect(res);
    }
    send(res, 404, page("Not found", `<h1>Not found</h1><p><a href="/">Back to Sensei</a></p>`));
  } catch (e) {
    console.error(e);
    send(res, 500, page("Error", `<h1>Something went wrong</h1><p class="bad">${esc(String((e as Error).message).slice(0, 300))}</p><p><a href="/">Back</a></p>`));
  }
}).listen(PORT, () => console.log(`Sensei on :${PORT}`));
