// Sprites REST client for CONTROL Sprites only (Sensei, Test Drive).
// Fly's gateway refuses connectors that target the Sprites API itself, so this uses a dedicated,
// revocable token stored only on the control Sprite (mode 0600). Training/repo Sprites never get it.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const API = "https://api.sprites.dev/v1/sprites";
const TOKEN_FILE = process.env.HG_SPRITES_TOKEN_FILE ?? "/home/sprite/.config/hg/sprites-token";
let token: string | null = null;
const auth = () => (token ??= readFileSync(TOKEN_FILE, "utf8").trim());

async function call(method: string, path: string, opts: { json?: unknown; raw?: Buffer; query?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { authorization: `Bearer ${auth()}` };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
  else if (opts.raw !== undefined) { headers["content-type"] = "application/octet-stream"; body = opts.raw; }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
  if (!res.ok && res.status !== 204) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

export const createSprite = async (name: string, isPublic: boolean) =>
  (await (await call("POST", "", { json: { name, url_settings: { auth: isPublic ? "public" : "sprite" } } })).json()) as { name: string; url: string };
export const deleteSprite = async (name: string) => { await call("DELETE", `/${name}`); };

export async function writeFile(sprite: string, path: string, content: string, mode = "0644") {
  await call("PUT", `/${sprite}/fs/write`, { raw: Buffer.from(content), query: { path, workingDir: "/", mkdirParents: "true", mode } });
}

export async function readFile(sprite: string, path: string): Promise<string | null> {
  try { return await (await call("GET", `/${sprite}/fs/read`, { query: { path, workingDir: "/" }, timeoutMs: 20_000 })).text(); }
  catch { return null; }
}

export async function putService(sprite: string, name: string, cmd: string, args: string[] = []) {
  await (await call("PUT", `/${sprite}/services/${name}`, { json: { cmd, args }, query: { duration: "1s" } })).text();
}
export async function deleteService(sprite: string, name: string) {
  try { await call("DELETE", `/${sprite}/services/${name}`); } catch { /* already gone */ }
}

/**
 * Run a bash command inside another Sprite: one-shot service + output file. Returns exit code and output.
 * keep=true leaves the idle service in place. Deleting a service kills EVERY process it started (even
 * setsid/nohup ones), so commands that plant long-running processes must keep it; a restore clears it.
 */
export async function run(sprite: string, cmd: string, timeoutMs = 120_000, keep = false): Promise<{ code: number | null; out: string }> {
  const id = randomBytes(4).toString("hex");
  // /var/tmp, not /tmp: /tmp is a separate volume that snapshots don't cover, so files there survive a restore.
  const out = `/var/tmp/sx-${id}.out`, done = `/var/tmp/sx-${id}.done`, script = `/var/tmp/sx-${id}.sh`;
  await writeFile(sprite, script, `#!/usr/bin/env bash\n[ -f ${done} ] && exec sleep infinity\n( ${cmd} ) > ${out} 2>&1; echo $? > ${done}\nexec sleep infinity\n`, "0755");
  await putService(sprite, `sx-${id}`, "bash", [script]);
  const start = Date.now();
  let code: number | null = null;
  while (Date.now() - start < timeoutMs) {
    const d = await readFile(sprite, done);
    if (d?.trim()) { code = Number(d.trim()); break; }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const output = (await readFile(sprite, out)) ?? "";
  if (!keep) await deleteService(sprite, `sx-${id}`);
  return { code, out: output };
}

export async function checkpoint(sprite: string, comment: string): Promise<string> {
  const text = await (await call("POST", `/${sprite}/checkpoint`, { json: { comment }, timeoutMs: 300_000 })).text();
  return text.match(/Checkpoint (v\d+) created/)?.[1] ?? "";
}

/** Restore a snapshot. The target restarts; its services (shop, terminal) come back on boot. */
export async function restore(sprite: string, id: string): Promise<number> {
  const t = Date.now();
  await (await call("POST", `/${sprite}/checkpoints/${id}/restore`, { timeoutMs: 300_000 })).text();
  return Date.now() - t;
}
