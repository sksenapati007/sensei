import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

/** Run a shell command with a timeout; never throws on non-zero exit. */
export function sh(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 2_000_000; // keep memory bounded
    child.stdout.on("data", (d) => { if (stdout.length < cap) stdout += d; });
    child.stderr.on("data", (d) => { if (stderr.length < cap) stderr += d; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}
