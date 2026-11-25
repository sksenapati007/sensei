import { gw, has } from "./gateway.ts";

// LLM access, open-source first:
//   1. Local Ollama on the Sprite (open model, free, nothing leaves the machine)
//   2. Ollama Cloud via the Sprites "ollama" connector (needs paid credits on this account)
// Pick with HG_LLM=local|cloud (default: local, falling back to cloud).

const LOCAL_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const LOCAL_MODEL = process.env.HG_LOCAL_MODEL ?? "qwen2.5:7b"; // 3b proved unreliable for judgement
const CLOUD_MODEL = process.env.HG_CLOUD_MODEL ?? "gpt-oss:120b";

type Msg = { role: "system" | "user"; content: string };

async function localUp(): Promise<boolean> {
  try {
    const r = await fetch(`${LOCAL_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ollamaChat(base: (path: string, init: RequestInit) => Promise<Response>, model: string, messages: Msg[], json: boolean, maxTokens: number) {
  const res = await base("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, ...(json ? { format: "json" } : {}), options: { num_predict: maxTokens, temperature: 0.2 } }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message: { content: string } };
  return body.message.content;
}

async function complete(system: string, user: string, json: boolean, maxTokens: number): Promise<string> {
  const messages: Msg[] = [{ role: "system", content: system }, { role: "user", content: user }];
  const choice = process.env.HG_LLM ?? "local";

  if (choice === "local" && (await localUp())) {
    return ollamaChat((p, i) => fetch(`${LOCAL_URL}${p}`, i), LOCAL_MODEL, messages, json, maxTokens);
  }
  if (await has("ollama")) {
    return ollamaChat((p, i) => gw("ollama", p, i), CLOUD_MODEL, messages, json, maxTokens);
  }
  throw new Error("No LLM available: start local Ollama, or add the Ollama connector.");
}

export async function available(): Promise<boolean> {
  return (await localUp()) || (await has("ollama"));
}

export function ask(system: string, user: string, maxTokens = 1500): Promise<string> {
  return complete(system, user, false, maxTokens);
}

export async function askJson<T>(system: string, user: string, maxTokens = 1500): Promise<T> {
  const raw = await complete(`${system}\nRespond with a single JSON object only. No prose.`, user, true, maxTokens);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned) as T;
}
