import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  appendFile,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  arch,
  cpus,
  EOL,
  freemem,
  homedir,
  hostname,
  platform,
  release,
  tmpdir,
  totalmem,
  type,
  uptime,
  userInfo,
} from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import type { PluginRegistry } from "./registry.js";
import type { ActionDef, InputSchema, PluginDef } from "./types.js";

const exec = promisify(execCb);
const execFile = promisify(execFileCb);

type JsonObject = Record<string, unknown>;

type NodeAction = Omit<ActionDef, "name">;

const pathInput = (description = "Filesystem path"): InputSchema => ({
  path: { type: "string", required: true, description },
});

function action(name: string, def: NodeAction): ActionDef {
  return { name, ...def };
}

export function registerNodePlugin(registry: PluginRegistry): void {
  registry.register(nodePlugin);
}

export const nodePlugin: PluginDef = {
  name: "node",
  version: "0.1.0",
  actions: [
    // fs/promises-shaped actions
    action("fs.readFile", {
      description: "Read a file from the host filesystem",
      inputSchema: {
        path: { type: "string", required: true, description: "File path" },
        encoding: {
          type: "string",
          required: false,
          description:
            "Text encoding. Defaults to utf8. Use base64 for binary-safe reads.",
        },
      },
      async execute(input) {
        const { path, encoding = "utf8" } = objectInput<{
          path: string;
          encoding?: BufferEncoding;
        }>(input);
        return readFile(path, { encoding });
      },
    }),
    action("fs.writeFile", {
      description: "Write text data to a file on the host filesystem",
      inputSchema: {
        path: { type: "string", required: true, description: "File path" },
        data: { type: "string", required: true, description: "File contents" },
        encoding: {
          type: "string",
          required: false,
          description: "Text encoding. Defaults to utf8.",
        },
      },
      async execute(input) {
        const {
          path,
          data,
          encoding = "utf8",
        } = objectInput<{
          path: string;
          data: string;
          encoding?: BufferEncoding;
        }>(input);
        await writeFile(path, data, { encoding });
        return ok({ path });
      },
    }),
    action("fs.appendFile", {
      description: "Append text data to a file on the host filesystem",
      inputSchema: {
        path: { type: "string", required: true, description: "File path" },
        data: {
          type: "string",
          required: true,
          description: "File contents to append",
        },
        encoding: {
          type: "string",
          required: false,
          description: "Text encoding. Defaults to utf8.",
        },
      },
      async execute(input) {
        const {
          path,
          data,
          encoding = "utf8",
        } = objectInput<{
          path: string;
          data: string;
          encoding?: BufferEncoding;
        }>(input);
        await appendFile(path, data, { encoding });
        return ok({ path });
      },
    }),
    action("fs.readdir", {
      description: "List a directory",
      inputSchema: {
        ...pathInput("Directory path"),
        withFileTypes: {
          type: "boolean",
          required: false,
          description: "Return typed entries instead of names",
        },
      },
      async execute(input) {
        const { path, withFileTypes = false } = objectInput<{
          path: string;
          withFileTypes?: boolean;
        }>(input);
        if (!withFileTypes) return readdir(path);
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
      },
    }),
    action("fs.stat", {
      description: "Stat a filesystem path",
      inputSchema: pathInput(),
      async execute(input) {
        return serializeStats(
          await stat(objectInput<{ path: string }>(input).path),
        );
      },
    }),
    action("fs.lstat", {
      description: "lstat a filesystem path",
      inputSchema: pathInput(),
      async execute(input) {
        return serializeStats(
          await lstat(objectInput<{ path: string }>(input).path),
        );
      },
    }),
    action("fs.exists", {
      description: "Check whether a filesystem path exists",
      inputSchema: pathInput(),
      execute(input) {
        return existsSync(objectInput<{ path: string }>(input).path);
      },
    }),
    action("fs.access", {
      description: "Check file access",
      inputSchema: pathInput(),
      async execute(input) {
        await access(objectInput<{ path: string }>(input).path);
        return ok();
      },
    }),
    action("fs.mkdir", {
      description: "Create a directory",
      inputSchema: {
        ...pathInput(),
        recursive: {
          type: "boolean",
          required: false,
          description: "Create parent directories. Defaults to true.",
        },
      },
      async execute(input) {
        const { path, recursive = true } = objectInput<{
          path: string;
          recursive?: boolean;
        }>(input);
        await mkdir(path, { recursive });
        return ok({ path });
      },
    }),
    action("fs.rm", {
      description: "Remove a file or directory",
      inputSchema: {
        ...pathInput(),
        recursive: {
          type: "boolean",
          required: false,
          description: "Remove directories recursively",
        },
        force: {
          type: "boolean",
          required: false,
          description: "Ignore missing paths",
        },
      },
      async execute(input) {
        const {
          path,
          recursive = false,
          force = false,
        } = objectInput<{
          path: string;
          recursive?: boolean;
          force?: boolean;
        }>(input);
        await rm(path, { recursive, force });
        return ok({ path });
      },
    }),
    action("fs.unlink", {
      description: "Remove a file",
      inputSchema: pathInput(),
      async execute(input) {
        const { path } = objectInput<{ path: string }>(input);
        await unlink(path);
        return ok({ path });
      },
    }),
    action("fs.rename", {
      description: "Rename a file or directory",
      inputSchema: {
        from: { type: "string", required: true, description: "Source path" },
        to: { type: "string", required: true, description: "Destination path" },
      },
      async execute(input) {
        const { from, to } = objectInput<{ from: string; to: string }>(input);
        await rename(from, to);
        return ok({ from, to });
      },
    }),
    action("fs.copyFile", {
      description: "Copy a file",
      inputSchema: {
        from: { type: "string", required: true, description: "Source path" },
        to: { type: "string", required: true, description: "Destination path" },
      },
      async execute(input) {
        const { from, to } = objectInput<{ from: string; to: string }>(input);
        await copyFile(from, to);
        return ok({ from, to });
      },
    }),

    // path-shaped actions. Most accept either an array or { segments: string[] }.
    action("path.join", {
      description: "Join path segments",
      inputSchema: {
        segments: {
          type: "array",
          required: true,
          description: "Path segments",
        },
      },
      execute(input) {
        return join(...stringArrayInput(input));
      },
    }),
    action("path.resolve", {
      description: "Resolve path segments",
      inputSchema: {
        segments: {
          type: "array",
          required: true,
          description: "Path segments",
        },
      },
      execute(input) {
        return resolve(...stringArrayInput(input));
      },
    }),
    action("path.normalize", {
      description: "Normalize a path",
      inputSchema: pathInput(),
      execute(input) {
        return normalize(objectInput<{ path: string }>(input).path);
      },
    }),
    action("path.dirname", {
      description: "Get a path dirname",
      inputSchema: pathInput(),
      execute(input) {
        return dirname(objectInput<{ path: string }>(input).path);
      },
    }),
    action("path.basename", {
      description: "Get a path basename",
      inputSchema: {
        ...pathInput(),
        suffix: {
          type: "string",
          required: false,
          description: "Optional suffix to remove",
        },
      },
      execute(input) {
        const { path, suffix } = objectInput<{ path: string; suffix?: string }>(
          input,
        );
        return basename(path, suffix);
      },
    }),
    action("path.extname", {
      description: "Get a path extension",
      inputSchema: pathInput(),
      execute(input) {
        return extname(objectInput<{ path: string }>(input).path);
      },
    }),
    action("path.relative", {
      description: "Get a relative path",
      inputSchema: {
        from: { type: "string", required: true, description: "Source path" },
        to: { type: "string", required: true, description: "Destination path" },
      },
      execute(input) {
        const { from, to } = objectInput<{ from: string; to: string }>(input);
        return relative(from, to);
      },
    }),
    action("path.isAbsolute", {
      description: "Check whether a path is absolute",
      inputSchema: pathInput(),
      execute(input) {
        return isAbsolute(objectInput<{ path: string }>(input).path);
      },
    }),
    action("path.parse", {
      description: "Parse a path into components",
      inputSchema: pathInput(),
      execute(input) {
        return parse(objectInput<{ path: string }>(input).path);
      },
    }),
    action("path.format", {
      description: "Format a path object into a path string",
      inputSchema: {
        pathObject: {
          type: "object",
          required: true,
          description: "Node path object",
        },
      },
      execute(input) {
        return format(
          objectInput<{ pathObject: Parameters<typeof format>[0] }>(input)
            .pathObject,
        );
      },
    }),
    action("path.constants", {
      description: "Get path separator constants",
      execute() {
        return { sep, delimiter };
      },
    }),

    // os/process/shell actions
    action("os.info", {
      description: "Get useful host OS information",
      execute() {
        return {
          platform: platform(),
          arch: arch(),
          type: type(),
          release: release(),
          hostname: hostname(),
          homedir: homedir(),
          tmpdir: tmpdir(),
          uptime: uptime(),
          totalmem: totalmem(),
          freemem: freemem(),
          eol: EOL,
          cpus: cpus().map((cpu) => ({ model: cpu.model, speed: cpu.speed })),
        };
      },
    }),
    action("os.platform", {
      description: "Get OS platform",
      execute: () => platform(),
    }),
    action("os.arch", {
      description: "Get OS architecture",
      execute: () => arch(),
    }),
    action("os.homedir", {
      description: "Get home directory",
      execute: () => homedir(),
    }),
    action("os.tmpdir", {
      description: "Get temp directory",
      execute: () => tmpdir(),
    }),
    action("os.userInfo", {
      description: "Get current user information",
      execute() {
        const info = userInfo();
        return {
          username: info.username,
          uid: info.uid,
          gid: info.gid,
          shell: info.shell,
          homedir: info.homedir,
        };
      },
    }),
    action("process.cwd", {
      description: "Get the current working directory",
      execute: () => process.cwd(),
    }),
    action("process.env", {
      description: "Read environment variables from the host process",
      inputSchema: {
        name: {
          type: "string",
          required: false,
          description: "Optional variable name. Omit to return all env vars.",
        },
      },
      execute(input) {
        const name = (input as { name?: string } | undefined)?.name;
        return name ? process.env[name] : { ...process.env };
      },
    }),
    action("process.exec", {
      description: "Run a shell command on the host",
      inputSchema: {
        command: {
          type: "string",
          required: true,
          description: "Shell command",
        },
        cwd: {
          type: "string",
          required: false,
          description: "Working directory",
        },
        timeout: {
          type: "number",
          required: false,
          description: "Timeout in milliseconds",
        },
      },
      async execute(input) {
        const { command, cwd, timeout } = objectInput<{
          command: string;
          cwd?: string;
          timeout?: number;
        }>(input);
        const { stdout, stderr } = await exec(command, {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout, stderr };
      },
    }),
    action("process.execFile", {
      description: "Run a host executable without a shell",
      inputSchema: {
        file: {
          type: "string",
          required: true,
          description: "Executable path or name",
        },
        args: { type: "array", required: false, description: "Arguments" },
        cwd: {
          type: "string",
          required: false,
          description: "Working directory",
        },
        timeout: {
          type: "number",
          required: false,
          description: "Timeout in milliseconds",
        },
      },
      async execute(input) {
        const {
          file,
          args = [],
          cwd,
          timeout,
        } = objectInput<{
          file: string;
          args?: string[];
          cwd?: string;
          timeout?: number;
        }>(input);
        const { stdout, stderr } = await execFile(file, args, {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout, stderr };
      },
    }),
    action("crypto.randomUUID", {
      description: "Generate a random UUID using the host crypto runtime",
      execute() {
        return randomUUID();
      },
    }),
    action("crypto.randomBytes", {
      description:
        "Generate cryptographically strong random bytes as hex or base64",
      inputSchema: {
        size: {
          type: "number",
          required: true,
          description: "Number of bytes",
        },
        encoding: {
          type: "string",
          required: false,
          description: "hex or base64. Defaults to hex.",
        },
      },
      execute(input) {
        const { size, encoding = "hex" } = objectInput<{
          size: number;
          encoding?: BufferEncoding;
        }>(input);
        return randomBytes(size).toString(encoding);
      },
    }),
    action("crypto.hash", {
      description: "Hash text data with a Node crypto digest algorithm",
      inputSchema: {
        algorithm: {
          type: "string",
          required: false,
          description: "Digest algorithm. Defaults to sha256.",
        },
        data: { type: "string", required: true, description: "Data to hash" },
        encoding: {
          type: "string",
          required: false,
          description: "Digest encoding. Defaults to hex.",
        },
      },
      execute(input) {
        const {
          algorithm = "sha256",
          data,
          encoding = "hex",
        } = objectInput<{
          algorithm?: string;
          data: string;
          encoding?: Parameters<ReturnType<typeof createHash>["digest"]>[0];
        }>(input);
        return createHash(algorithm).update(data).digest(encoding);
      },
    }),
    action("fetch", {
      description: "Perform an HTTP fetch from the host runtime",
      inputSchema: {
        url: { type: "string", required: true, description: "Request URL" },
        method: { type: "string", required: false, description: "HTTP method" },
        headers: {
          type: "object",
          required: false,
          description: "Request headers",
        },
        body: { type: "string", required: false, description: "Request body" },
      },
      async execute(input) {
        const { url, method, headers, body } = objectInput<{
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        }>(input);
        const res = await fetch(url, { method, headers, body });
        const contentType = res.headers.get("content-type") ?? "";
        const text = await res.text();
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          body: contentType.includes("application/json")
            ? safeJson(text)
            : text,
        };
      },
    }),
  ],
};

function objectInput<T extends JsonObject>(input: unknown): T {
  return (input && typeof input === "object" ? input : {}) as T;
}

function stringArrayInput(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String);
  const { segments } = objectInput<{ segments?: unknown[] }>(input);
  return Array.isArray(segments) ? segments.map(String) : [];
}

function ok(extra: JsonObject = {}): JsonObject {
  return { ok: true, ...extra };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function serializeStats(s: Awaited<ReturnType<typeof stat>>): JsonObject {
  return {
    size: s.size,
    mode: s.mode,
    uid: s.uid,
    gid: s.gid,
    atimeMs: s.atimeMs,
    mtimeMs: s.mtimeMs,
    ctimeMs: s.ctimeMs,
    birthtimeMs: s.birthtimeMs,
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymbolicLink: s.isSymbolicLink(),
    isBlockDevice: s.isBlockDevice(),
    isCharacterDevice: s.isCharacterDevice(),
    isFIFO: s.isFIFO(),
    isSocket: s.isSocket(),
  };
}
