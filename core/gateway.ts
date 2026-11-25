// Calls external APIs through the Sprites connector gateway.
// No credentials live in the Sprite: the gateway injects them.
const GATEWAY = "https://api.sprites.dev/v1/gateway";

interface Connection {
  id?: string;
  connection_id?: string;
  provider: string;
  [k: string]: unknown;
}

let cache: Connection[] | null = null;

export async function connections(): Promise<Connection[]> {
  if (cache) return cache;
  const res = await fetch(`${GATEWAY}/list`);
  if (!res.ok) throw new Error(`gateway list failed: ${res.status}`);
  const body = (await res.json()) as { connections: Connection[] };
  cache = body.connections ?? [];
  return cache;
}

export async function connectionId(provider: string): Promise<string> {
  const conn = (await connections()).find((c) => c.provider === provider);
  if (!conn) {
    throw new Error(
      `No "${provider}" connector is available to this Sprite. Add it in the Fly dashboard (Sprites → Connectors) with a policy that admits this Sprite.`,
    );
  }
  return String(conn.connection_id ?? conn.id);
}

/** fetch() against a provider through the gateway, e.g. gw("github", "/user", {...}) */
export async function gw(provider: string, path: string, init: RequestInit = {}): Promise<Response> {
  const id = await connectionId(provider);
  return fetch(`${GATEWAY}/${provider}/${id}${path}`, init);
}

export async function has(provider: string): Promise<boolean> {
  try {
    return (await connections()).some((c) => c.provider === provider);
  } catch {
    return false;
  }
}
