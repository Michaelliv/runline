import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { connectionFields } from "../plugin/schema.js";
import type { ConnectionConfig, ConnectionSchema } from "../plugin/types.js";
import { readConnectionFile, updateConnectionFile } from "./store.js";
import { DEFAULT_CONFIG, type RunlineConfig } from "./types.js";

const CONFIG_DIR_NAME = ".runline";
const CONFIG_FILE = "config.json";

export function findConfigDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, CONFIG_DIR_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function configPath(): string {
  return join(
    findConfigDir() ?? join(process.cwd(), CONFIG_DIR_NAME),
    CONFIG_FILE,
  );
}

export function loadConfigFrom(path: string): RunlineConfig {
  return { ...DEFAULT_CONFIG, ...readConnectionFile(path) };
}

export function loadConfig(): RunlineConfig {
  return loadConfigFrom(configPath());
}

/** Replace the entire config, fencing handles bound to its previous accounts. */
export async function saveConfig(config: RunlineConfig): Promise<void> {
  const replacement = structuredClone(config);
  await updateConnectionFile(configPath(), (data) => {
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, replacement, {
      connections: replacement.connections.map((entry) => ({
        ...entry,
        generation: randomUUID(),
      })),
    });
    return { result: undefined, write: true };
  });
}

/** A new generation fences handles from an earlier login with the same name. */
export async function addConnection(
  name: string,
  plugin: string,
  configValues: Record<string, unknown>,
): Promise<void> {
  const conn = {
    name,
    plugin,
    config: structuredClone(configValues),
    generation: randomUUID(),
  };
  await updateConnectionFile(configPath(), (data) => {
    const existing = data.connections.findIndex((c) => c.name === name);
    if (existing >= 0) data.connections[existing] = conn;
    else data.connections.push(conn);
    return { result: undefined, write: true };
  });
}

export async function removeConnection(name: string): Promise<boolean> {
  return updateConnectionFile(configPath(), (data) => {
    const idx = data.connections.findIndex((c) => c.name === name);
    if (idx < 0) return { result: false, write: false };
    data.connections.splice(idx, 1);
    return { result: true, write: true };
  });
}

/** Administrative patch. Plugin refreshes use their resolved connection handle. */
export async function updateConnectionConfig(
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const copy = structuredClone(patch);
  await updateConnectionFile(configPath(), (data) => {
    const current = data.connections.find((entry) => entry.name === name);
    if (!current) throw new Error(`Connection not found: ${name}`);
    current.config = { ...current.config, ...copy };
    return { result: undefined, write: true };
  });
}

export function getConnection(
  plugin: string,
  name?: string,
): ConnectionConfig | undefined {
  const config = loadConfig();
  return config.connections.find(
    (c) => c.plugin === plugin && (name === undefined || c.name === name),
  );
}

export function applyEnvOverrides(
  conn: ConnectionConfig,
  schema?: ConnectionSchema,
): ConnectionConfig {
  if (!schema) return conn;
  const config = { ...conn.config };
  for (const [key, field] of Object.entries(connectionFields(schema))) {
    if (field.env && config[key] == null) {
      const envVal = process.env[field.env];
      if (envVal) config[key] = envVal;
    }
  }
  return { ...conn, config };
}
