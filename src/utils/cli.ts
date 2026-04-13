import { execFileSync, execSync } from "node:child_process";

export type OutputParser = "json" | "jsonlines" | "text";

export interface ExecOptions {
  parser?: OutputParser;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  rows: Record<string, unknown>[];
}

export function syncExec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): ExecResult {
  const stdout = execFileSync(command, args, {
    encoding: "utf-8",
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    timeout: options.timeout,
    maxBuffer: 100 * 1024 * 1024,
  }).trim();

  const parser = options.parser ?? "text";
  let rows: Record<string, unknown>[] = [];

  if (parser === "json" && stdout) {
    const parsed = JSON.parse(stdout);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } else if (parser === "jsonlines" && stdout) {
    rows = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  return { stdout, rows };
}

export function commandExists(name: string): boolean {
  try {
    execSync(`which ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
