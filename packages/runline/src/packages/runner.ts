import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  signal?: AbortSignal;
  /** Milliseconds before the command is killed. */
  timeoutMs?: number;
}

/**
 * Runs npm, pnpm, bun and git for the package manager. Always an argument
 * list, never a shell string. A host replaces it to run them in a sandbox or
 * another process, or to refuse them (an offline host).
 */
export interface CommandRunner {
  run(
    command: string,
    args: string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

const OUTPUT_LIMIT = 1024 * 1024;

function quoteForCmd(arg: string): string {
  return /^[A-Za-z0-9_\-./:@=^~+]+$/.test(arg)
    ? arg
    : `"${arg.replace(/"/g, '""')}"`;
}

/** The default runner: `node:child_process` `spawn`, no shell (Windows needs one for `.cmd` shims). */
export const nodeCommandRunner: CommandRunner = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const windows = process.platform === "win32";
      const child = windows
        ? spawn([command, ...args].map(quoteForCmd).join(" "), {
            cwd: options.cwd,
            shell: true,
            signal: options.signal,
            windowsHide: true,
          })
        : spawn(command, args, {
            cwd: options.cwd,
            shell: false,
            signal: options.signal,
          });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString();
      });
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
      child.on("error", (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr });
      });
    });
  },
};
