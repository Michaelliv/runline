import type { RunlineConfig } from "./config/types.js";
import { DEFAULT_CONFIG } from "./config/types.js";
import { ExecutionEngine, type ExecuteResult } from "./core/engine.js";
import type { PluginFunction } from "./plugin/api.js";
import { resolvePluginExport } from "./plugin/api.js";
import { PluginRegistry } from "./plugin/registry.js";
import type {
  ConnectionConfig,
  PluginDef,
  RateLimitConfig,
} from "./plugin/types.js";

export interface RunlineOptions {
  plugins?: Array<PluginDef | PluginFunction>;
  connections?: ConnectionConfig[];
  rateLimits?: Record<string, RateLimitConfig>;
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
      rateLimits: options.rateLimits ?? {},
      timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      memoryLimitBytes:
        options.memoryLimitBytes ?? DEFAULT_CONFIG.memoryLimitBytes,
    };

    this.engine = new ExecutionEngine(this._registry, config);
  }

  static create(options: RunlineOptions = {}): Runline {
    return new Runline(options);
  }

  /** Execute TypeScript/JavaScript code in the sandbox. */
  async execute(code: string): Promise<ExecuteResult> {
    return this.engine.execute(code);
  }

  /** List all available actions across all plugins. */
  actions(): Array<{
    plugin: string;
    action: string;
    description?: string;
  }> {
    return this._registry.getAllActions().map(({ plugin, action }) => ({
      plugin,
      action: action.name,
      description: action.description,
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
}
