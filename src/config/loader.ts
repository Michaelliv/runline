import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
