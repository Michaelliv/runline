import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import type { RunlineConfig } from "./config/types.js";
import { DEFAULT_CONFIG } from "./config/types.js";
import { type ExecuteResult, ExecutionEngine } from "./core/engine.js";
import type { PluginFunction } from "./plugin/api.js";
import { resolvePluginExport } from "./plugin/api.js";
import { loadAllPlugins } from "./plugin/loader.js";
import {
  registry as globalRegistry,
  PluginRegistry,
} from "./plugin/registry.js";
import type {
  ConnectionConfig,
  InputSchema,
  PluginDef,
} from "./plugin/types.js";

export interface RunlineOptions {
  plugins?: Array<PluginDef | PluginFunction>;
  connections?: ConnectionConfig[];
  timeoutMs?: number;
  memoryLimitBytes?: number;
}

export class Runline {
  private engine: ExecutionEngine;
  private _registry: PluginRegistry;

  private constructor(options: RunlineOptions) {
    this._registry = new PluginRegistry();

    for (const pluginOrFn of options.plugins ?? []) {
      const plugin = resolvePluginExport(pluginOrFn, "unknown");
      this._registry.register(plugin);
    }

    const config: RunlineConfig = {
      connections: options.connections ?? [],
      timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      memoryLimitBytes:
        options.memoryLimitBytes ?? DEFAULT_CONFIG.memoryLimitBytes,
    };

    this.engine = new ExecutionEngine(this._registry, config);
  }

  static create(options: RunlineOptions = {}): Runline {
    return new Runline(options);
  }

  /** Execute JavaScript code in the sandbox. */
  async execute(code: string): Promise<ExecuteResult> {
    return this.engine.execute(code);
  }

  /** List all available actions across all plugins. */
  actions(): Array<{
    plugin: string;
    action: string;
    description?: string;
    inputSchema?: InputSchema;
  }> {
    return this._registry.getAllActions().map(({ plugin, action }) => ({
      plugin,
      action: action.name,
      description: action.description,
      inputSchema: action.inputSchema,
    }));
  }

  /** List registered plugins. */
  plugins(): Array<{ name: string; version: string; actions: string[] }> {
    return this._registry.listPlugins().map((p) => ({
      name: p.name,
      version: p.version,
      actions: p.actions.map((a) => a.name),
    }));
  }

  /**
   * Load runline from a project directory.
   * Discovers .runline/ config and installed plugins, just like the CLI.
   */
  static async fromProject(cwd?: string): Promise<Runline | null> {
    const dir = cwd ?? process.cwd();
    const configDir = findRunlineDir(dir);
    if (!configDir) return null;

    // Temporarily change cwd so loaders find the right .runline/
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      await loadAllPlugins();
      const config = loadConfig();

      const rl = new Runline({
        connections: config.connections,
        timeoutMs: config.timeoutMs,
        memoryLimitBytes: config.memoryLimitBytes,
      });

      // Copy plugins from global registry into this instance
      for (const plugin of globalRegistry.listPlugins()) {
        rl._registry.register(plugin);
      }

      return rl;
    } finally {
      process.chdir(prevCwd);
    }
  }
}

function findRunlineDir(from: string): string | null {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, ".runline"))) return join(dir, ".runline");
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
