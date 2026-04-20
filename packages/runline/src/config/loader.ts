import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import type { ConnectionConfig } from "../plugin/types.js";
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

export function loadConfig(): RunlineConfig {
  const configDir = findConfigDir();
  if (!configDir) return { ...DEFAULT_CONFIG };

  const configPath = join(configDir, CONFIG_FILE);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: RunlineConfig): void {
  const configDir = findConfigDir() ?? join(process.cwd(), CONFIG_DIR_NAME);
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, CONFIG_FILE);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function addConnection(
  name: string,
  plugin: string,
  configValues: Record<string, unknown>,
): void {
  const config = loadConfig();
  const existing = config.connections.findIndex((c) => c.name === name);
  const conn: ConnectionConfig = { name, plugin, config: configValues };
  if (existing >= 0) {
    config.connections[existing] = conn;
  } else {
    config.connections.push(conn);
  }
  saveConfig(config);
}

export function removeConnection(name: string): boolean {
  const config = loadConfig();
  const idx = config.connections.findIndex((c) => c.name === name);
  if (idx < 0) return false;
  config.connections.splice(idx, 1);
  saveConfig(config);
  return true;
}

/**
 * Merge a partial config patch into an existing connection, atomically.
 *
 * Used by plugins that need to persist refreshed OAuth tokens (or any
 * other runtime-mutated credential) back to disk. The whole read-
 * modify-write is guarded by a file lock so two concurrent `runline
 * exec` processes refreshing the same token don't stomp each other.
 *
 * If the connection doesn't exist the call is a no-op.
 */
export async function updateConnectionConfig(
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const configDir = findConfigDir() ?? join(process.cwd(), CONFIG_DIR_NAME);
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, CONFIG_FILE);
  if (!existsSync(configPath)) writeFileSync(configPath, "{}\n");

  const release = await lockfile.lock(configPath, {
    retries: { retries: 10, factor: 2, minTimeout: 50, maxTimeout: 2_000 },
    stale: 30_000,
    realpath: false,
  });
  try {
    let raw: RunlineConfig;
    try {
      raw = {
        ...DEFAULT_CONFIG,
        ...JSON.parse(readFileSync(configPath, "utf-8")),
      };
    } catch {
      raw = { ...DEFAULT_CONFIG };
    }
    const idx = raw.connections.findIndex((c) => c.name === name);
    if (idx < 0) return;
    raw.connections[idx] = {
      ...raw.connections[idx],
      config: { ...raw.connections[idx].config, ...patch },
    };
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  } finally {
    await release();
  }
}

export function getConnection(
  plugin: string,
  name?: string,
): ConnectionConfig | undefined {
  const config = loadConfig();
  if (name) return config.connections.find((c) => c.name === name);
  return config.connections.find((c) => c.plugin === plugin);
}

export function applyEnvOverrides(
  conn: ConnectionConfig,
  schema?: Record<string, { env?: string }>,
): ConnectionConfig {
  if (!schema) return conn;
  const config = { ...conn.config };
  for (const [key, field] of Object.entries(schema)) {
    if (field.env && !config[key]) {
      const envVal = process.env[field.env];
      if (envVal) config[key] = envVal;
    }
  }
  return { ...conn, config };
}
