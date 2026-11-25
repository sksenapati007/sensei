// Phone notifications via ntfy (open source, Apache-2.0/GPL-2.0, free, no signup).
// Install the ntfy app, subscribe to your topic, set HG_NTFY_TOPIC to the same name.
// Topics on ntfy.sh are public-by-obscurity: use a long random name, e.g. "shubu-hg-7f3k9q2x".
// Point HG_NTFY_URL at a self-hosted ntfy (it runs fine on a Sprite) to keep it fully yours.
const BASE = process.env.HG_NTFY_URL ?? "https://ntfy.sh";
const TOPIC = process.env.HG_NTFY_TOPIC;

export async function notify(title: string, message: string, opts: { url?: string; priority?: 1 | 2 | 3 | 4 | 5; tags?: string[] } = {}): Promise<boolean> {
  if (!TOPIC) return false;
  const headers: Record<string, string> = { Title: title };
  if (opts.url) headers.Click = opts.url;
  if (opts.priority) headers.Priority = String(opts.priority);
  if (opts.tags?.length) headers.Tags = opts.tags.join(",");
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(TOPIC)}`, { method: "POST", headers, body: message });
    return res.ok;
  } catch {
    return false;
  }
}
