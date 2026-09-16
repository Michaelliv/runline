import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { ConnectionConfig } from "../plugin/types.js";

export interface ConnectionFile {
  connections: Array<ConnectionConfig & { generation?: string }>;
  [key: string]: unknown;
}

/** Missing files are empty; invalid files never become empty credential stores. */
export function readConnectionFile(path: string): ConnectionFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { connections: [] };
    throw new Error("Invalid connection file: unreadable or malformed JSON");
  }
  let data: ConnectionFile;
  try {
    data = JSON.parse(text);
  } catch {
    // JSON parser diagnostics can include secret-bearing input.
    throw new Error("Invalid connection file: unreadable or malformed JSON");
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data.connections !== undefined && !Array.isArray(data.connections))
  ) {
    throw new Error("Invalid connection file: expected connections array");
  }
  data.connections ??= [];
  const names = new Set<string>();
  for (const entry of data.connections) {
    if (
      !entry ||
      typeof entry.name !== "string" ||
      typeof entry.plugin !== "string" ||
      !entry.config ||
      typeof entry.config !== "object" ||
      Array.isArray(entry.config) ||
      (entry.generation !== undefined &&
        typeof entry.generation !== "string") ||
      names.has(entry.name)
    ) {
      throw new Error(
        "Invalid connection file: malformed or duplicate connection",
      );
    }
    names.add(entry.name);
  }
  return data;
}

/** All local writes share ownership across reread, async work, and atomic commit. */
export async function updateConnectionFile<T>(
  path: string,
  update: (
    data: ConnectionFile,
  ) => Promise<{ result: T; write: boolean }> | { result: T; write: boolean },
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true });
  let compromised: Error | undefined;
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 30_000,
    retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2_000 },
    onCompromised: (error) => {
      compromised = error;
    },
  });
  try {
    if (compromised) throw compromised;
    const data = readConnectionFile(path);
    const { result, write } = await update(data);
    if (compromised) throw compromised;
    if (write) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return result;
  } finally {
    await release();
  }
}
