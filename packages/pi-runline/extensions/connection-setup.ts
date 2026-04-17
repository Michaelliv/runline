import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type ConnectionSchemaField = {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  env?: string;
};

type PluginSummary = {
  name: string;
  connectionConfigSchema?: Record<string, ConnectionSchemaField>;
};

type Connection = {
  name: string;
  plugin: string;
  config: Record<string, unknown>;
};

function readConfig(runlineDir: string): Record<string, unknown> {
  const configPath = path.join(runlineDir, "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(
  runlineDir: string,
  config: Record<string, unknown>,
): void {
  const configPath = path.join(runlineDir, "config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function getConnections(config: Record<string, unknown>): Connection[] {
  const raw = config.connections;
  return Array.isArray(raw) ? (raw as Connection[]) : [];
}

function connectionFor(
  connections: Connection[],
  plugin: string,
): Connection | undefined {
  return connections.find((c) => c.plugin === plugin);
}

function isSchemaEmpty(schema: PluginSummary["connectionConfigSchema"]): boolean {
  return !schema || Object.keys(schema).length === 0;
}

function envOrSchemaDefault(
  field: ConnectionSchemaField,
): string | undefined {
  if (field.env && process.env[field.env]) return process.env[field.env];
  if (field.default !== undefined) return String(field.default);
  return undefined;
}

/**
 * Walk through newly-enabled plugins and prompt for any credentials that
 * don't already have a connection (and aren't already resolvable via env).
 * Skips plugins with no connection schema.
 *
 * Returns the list of plugin names that ended up with a saved connection.
 */
export async function promptForCredentials(
  ctx: ExtensionCommandContext,
  runlineDir: string,
  plugins: PluginSummary[],
  newlyEnabled: string[],
): Promise<string[]> {
  const config = readConfig(runlineDir);
  const connections = getConnections(config);
  const saved: string[] = [];

  for (const name of newlyEnabled) {
    const plugin = plugins.find((p) => p.name === name);
    if (!plugin) continue;

    const schema = plugin.connectionConfigSchema;
    if (isSchemaEmpty(schema)) continue; // no creds needed

    if (connectionFor(connections, name)) continue; // already configured

    // Check env — if every required field has an env var set, skip the prompt.
    const requiredFields = Object.entries(schema!).filter(
      ([, f]) => f.required,
    );
    const allFromEnv = requiredFields.every(
      ([, f]) => f.env && process.env[f.env],
    );
    if (requiredFields.length > 0 && allFromEnv) continue;

    const wantSetup = await ctx.ui.confirm(
      `Set up ${name}?`,
      `${name} needs credentials. Configure now?`,
    );
    if (!wantSetup) continue;

    const values: Record<string, unknown> = {};
    let cancelled = false;
    for (const [key, field] of Object.entries(schema!)) {
      const placeholder = field.env
        ? `${field.description ?? key} (env: ${field.env})`
        : (field.description ?? key);
      const existing = envOrSchemaDefault(field);
      const prompt = existing
        ? `${key} [${existing.slice(0, 8)}…]`
        : `${key}${field.required ? " *" : ""}`;

      const answer = await ctx.ui.input(prompt, placeholder);
      if (answer === undefined) {
        cancelled = true;
        break;
      }
      const trimmed = answer.trim();
      if (trimmed) {
        values[key] = coerce(trimmed, field.type);
      } else if (field.required && !existing) {
        ctx.ui.notify(`${key} is required — skipping ${name}`, "warning");
        cancelled = true;
        break;
      }
    }

    if (cancelled) continue;

    const conn: Connection = {
      name,
      plugin: name,
      config: values,
    };
    connections.push(conn);
    saved.push(name);
  }

  if (saved.length > 0) {
    config.connections = connections;
    writeConfig(runlineDir, config);
  }

  return saved;
}

function coerce(value: string, type: string): unknown {
  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}
