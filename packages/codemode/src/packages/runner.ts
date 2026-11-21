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

/**
 * One argument for cmd.exe, quoted. Inside double quotes cmd still expands
 * `%VAR%` and ends the quote at `"`, so an argument carrying either (or a
 * line break) is refused rather than escaped.
 */
export function quoteForCmd(arg: string): string {
  if (/[%"\r\n]/.test(arg))
    throw new Error(`Argument cannot be passed through cmd.exe: ${arg}`);
  return /^[A-Za-z0-9_\-./:@=~+]+$/.test(arg) ? arg : `"${arg}"`;
}

/**
 * The default runner: `node:child_process` `spawn` with an argument list and
 * no shell. On Windows npm, pnpm and bun are `.cmd` shims that only a shell
 * can start, so those (never git) go through cmd.exe with every argument
 * quoted by `quoteForCmd`.
 */
export const nodeCommandRunner: CommandRunner = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const viaCmd = process.platform === "win32" && command !== "git";
      const child = viaCmd
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
            windowsHide: true,
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
