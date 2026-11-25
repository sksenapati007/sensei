import { sh } from "./sh.ts";

// Thin wrapper over the in-Sprite checkpoint CLI (talks to /.sprite/api.sock).

export interface Checkpoint {
  id: string;
  create_time: string;
  comment?: string;
}

export async function create(comment: string): Promise<string> {
  const r = await sh(`sprite-env checkpoints create --comment ${JSON.stringify(comment)}`, { timeoutMs: 60_000 });
  const m = r.stdout.match(/Checkpoint (v\d+) created/);
  if (!m) throw new Error(`checkpoint failed: ${r.stdout}${r.stderr}`);
  return m[1];
}

export async function list(): Promise<Checkpoint[]> {
  const r = await sh("sprite-env checkpoints list");
  const json = r.stdout.trim().split("\n").pop() ?? "[]";
  return (JSON.parse(json) as Checkpoint[]).filter((c) => c.id !== "Current");
}

/**
 * Restore is async and RESTARTS the environment: this process will die.
 * Persist anything you need first (or keep it outside the overlay).
 */
export async function restore(id: string): Promise<void> {
  await sh(`sprite-env checkpoints restore ${id}`, { timeoutMs: 30_000 });
}
