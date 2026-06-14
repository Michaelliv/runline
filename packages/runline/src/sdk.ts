import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunlineConfig } from "./config/types.js";
import { DEFAULT_CONFIG } from "./config/types.js";
import { type ExecuteResult, ExecutionEngine } from "./core/engine.js";
import type { PluginFunction } from "./plugin/api.js";
import { resolvePluginExport } from "./plugin/api.js";
import { discoverPlugins } from "./plugin/loader.js";
import { PluginRegistry } from "./plugin/registry.js";
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

export interface RunlineExecuteOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
}

export class Runline {
  private _registry: PluginRegistry;
  private _config: RunlineConfig;

  private constructor(options: RunlineOptions) {
    this._registry = new PluginRegistry();

    for (const pluginOrFn of options.plugins ?? []) {
      const plugin = resolvePluginExport(pluginOrFn, "unknown");
      this._registry.register(plugin);
    }

    this._config = {
      connections: options.connections ?? [],
      timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      memoryLimitBytes:
        options.memoryLimitBytes ?? DEFAULT_CONFIG.memoryLimitBytes,
    };
  }

  static create(options: RunlineOptions = {}): Runline {
    return new Runline(options);
  }

  /** Execute JavaScript code in the QuickJS runtime. */
  async execute(
    code: string,
    options?: RunlineExecuteOptions,
  ): Promise<ExecuteResult> {
    const engine = new ExecutionEngine(this._registry, this._config);
    return engine.execute(code, options);
  }

  /** Register an additional plugin after creation. */
  addPlugin(
    pluginOrFn: PluginDef | PluginFunction,
    connections?: ConnectionConfig[],
  ): void {
    const plugin = resolvePluginExport(pluginOrFn, "unknown");
    this._registry.register(plugin);
    if (connections) {
      this._config = {
        ...this._config,
        connections: [...this._config.connections, ...connections],
      };
    }
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
  plugins(): Array<{
    name: string;
    version: string;
    actions: string[];
    connectionConfigSchema?: PluginDef["connectionConfigSchema"];
  }> {
    return this._registry.listPlugins().map((p) => ({
      name: p.name,
      version: p.version,
      actions: p.actions.map((a) => a.name),
      connectionConfigSchema: p.connectionConfigSchema,
    }));
  }

  /** Return all connections currently configured. */
  connections(): ConnectionConfig[] {
    return [...this._config.connections];
  }

  /**
   * Load runline from a project directory.
   *
   * Discovers the `.runline/` config and registers:
   *   - every plugin dropped into `.runline/plugins/`,
   *   - every plugin listed in `.runline/plugins.json`,
   *   - every plugin in `~/.runline/plugins/`,
   *   - and — from the 188 builtins shipped with the package — only
   *     the ones named in `config.connections[].plugin`.
   *
   * Gating the builtins keeps `runline.actions()` scoped to what the
   * project actually configured. Without this, a project with a
   * single connection would still expose every bundled action to an
   * agent, which is both noisy and a privacy problem (the agent sees
   * surface area it has no credentials for).
   *
   * `options.builtinDir` is a test-only hook; production callers
   * should rely on the default path to the bundled plugins.
   *
   * Fully self-contained — does not mutate global state.
   */
  static async fromProject(
    cwd?: string,
    options: { builtinDir?: string } = {},
  ): Promise<Runline | null> {
    const dir = cwd ?? process.cwd();
    const configDir = findRunlineDir(dir);
    if (!configDir) return null;

    const config = loadConfigFrom(configDir);
    const builtinAllowlist = new Set(config.connections.map((c) => c.plugin));
    const plugins = await discoverPlugins(configDir, {
      builtinAllowlist,
      builtinDir: options.builtinDir,
    });

    const rl = new Runline({
      connections: config.connections,
      timeoutMs: config.timeoutMs,
      memoryLimitBytes: config.memoryLimitBytes,
    });

    for (const plugin of plugins) {
      rl._registry.register(plugin);
    }

    return rl;
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

function loadConfigFrom(configDir: string): RunlineConfig {
  const configPath = join(configDir, "config.json");
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
