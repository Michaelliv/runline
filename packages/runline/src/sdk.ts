import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfigFrom } from "./config/loader.js";
import type { RunlineConfig } from "./config/types.js";
import { DEFAULT_CONFIG } from "./config/types.js";
import { FileConnectionProvider } from "./connections/file.js";
import { MemoryConnectionProvider } from "./connections/memory.js";
import type { ConnectionProvider } from "./connections/types.js";
import {
  type EngineHooks,
  type ExecuteResult,
  ExecutionEngine,
} from "./core/engine.js";
import type { PluginFunction } from "./plugin/api.js";
import { resolvePluginExport } from "./plugin/api.js";
import { discoverPlugins } from "./plugin/loader.js";
import { PluginRegistry } from "./plugin/registry.js";
import type {
  ActionAccess,
  ConnectionConfig,
  InputSchema,
  PluginDef,
} from "./plugin/types.js";

export interface RunlineOptions {
  plugins?: Array<PluginDef | PluginFunction>;
  /** Initial process-local connections. No environment lookup or disk writes. */
  connections?: ConnectionConfig[];
  /** Host-owned credentials; mutually exclusive with initial connections. */
  connectionProvider?: ConnectionProvider;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  /**
   * Bodies one pooled worker may run before it is retired. See
   * `ExecutionEngine` — this bounds cross-run contamination, not memory.
   */
  maxRunsPerWorker?: number;
  /**
   * Observer fired in the host process for every action invocation
   * that enters a plugin's `execute()` — unknown paths and failed
   * input validation never reach plugin code and are not reported.
   * Exceptions thrown by the observer are swallowed: observability
   * never breaks a run. Not part of `RunlineConfig` on purpose —
   * config round-trips through JSON (`fromProject`), functions do not.
   */
  onAction?: EngineHooks["onAction"];
}

export interface RunlineExecuteOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  /** Delivered to every action's `ctx.context` for this run. */
  context?: unknown;
}

export class Runline {
  private _registry: PluginRegistry;
  private _config: RunlineConfig;
  private readonly _connectionProvider: ConnectionProvider;
  private readonly _memoryConnections?: MemoryConnectionProvider;
  /**
   * One engine per Runline instance, so its pooled worker survives across
   * `execute()` calls and avoids per-execution thread allocation.
   */
  private _engine: ExecutionEngine | null = null;

  private readonly _onAction: EngineHooks["onAction"];

  private constructor(options: RunlineOptions) {
    this._registry = new PluginRegistry();
    this._onAction = options.onAction;
    if (options.connectionProvider && options.connections) {
      throw new Error("Pass connections or connectionProvider, not both");
    }
    if (options.connectionProvider) {
      this._connectionProvider = options.connectionProvider;
    } else {
      this._memoryConnections = new MemoryConnectionProvider(
        options.connections,
      );
      this._connectionProvider = this._memoryConnections;
    }

    for (const pluginOrFn of options.plugins ?? []) {
      const plugin = resolvePluginExport(pluginOrFn, "unknown");
      this._registry.register(plugin);
    }

    this._config = {
      connections: [],
      timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      memoryLimitBytes:
        options.memoryLimitBytes ?? DEFAULT_CONFIG.memoryLimitBytes,
      ...(options.maxRunsPerWorker !== undefined
        ? { maxRunsPerWorker: options.maxRunsPerWorker }
        : {}),
    };
  }

  private engine(): ExecutionEngine {
    if (!this._engine) {
      this._engine = new ExecutionEngine(this._registry, this._config, {
        onAction: this._onAction,
        connectionProvider: this._connectionProvider,
      });
    }
    return this._engine;
  }

  /**
   * Retire the pooled worker. Idempotent. Callers holding a long-lived
   * Runline should call this on shutdown; an idle pooled worker is unref'd
   * so it will not by itself keep a process alive.
   */
  dispose(): void {
    this._engine?.dispose();
    this._engine = null;
  }

  static create(options: RunlineOptions = {}): Runline {
    return new Runline(options);
  }

  /** Execute JavaScript code in a pooled worker. */
  async execute(
    code: string,
    options?: RunlineExecuteOptions,
  ): Promise<ExecuteResult> {
    return this.engine().execute(code, options);
  }

  /** Register an additional plugin after creation. */
  addPlugin(
    pluginOrFn: PluginDef | PluginFunction,
    connections?: ConnectionConfig[],
  ): void {
    const plugin = resolvePluginExport(pluginOrFn, "unknown");
    if (connections) {
      if (!this._memoryConnections) {
        throw new Error(
          "Configure connections through the host connection provider",
        );
      }
      this._memoryConnections.add(connections);
    }
    this._registry.register(plugin);
    // Rebuild the worker's action surface; connection custody survives disposal.
    this.dispose();
  }

  /** List all available actions across all plugins. */
  actions(): Array<{
    plugin: string;
    action: string;
    access?: ActionAccess;
    description?: string;
    inputSchema?: InputSchema;
  }> {
    return this._registry.getAllActions().map(({ plugin, action }) => ({
      plugin,
      action: action.name,
      access: action.access,
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

  /**
   * Snapshot of process-local connections. Host-managed providers are not
   * enumerated: their accounts can be caller-scoped and must be listed by the host.
   */
  connections(): ConnectionConfig[] {
    return this._memoryConnections?.list() ?? [];
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

    const config = loadConfigFrom(join(configDir, "config.json"));
    const builtinAllowlist = new Set(config.connections.map((c) => c.plugin));
    const plugins = await discoverPlugins(configDir, {
      builtinAllowlist,
      builtinDir: options.builtinDir,
    });

    const rl = new Runline({
      connectionProvider: new FileConnectionProvider(
        join(configDir, "config.json"),
      ),
      timeoutMs: config.timeoutMs,
      memoryLimitBytes: config.memoryLimitBytes,
      maxRunsPerWorker: config.maxRunsPerWorker,
    });

    for (const plugin of plugins) {
      rl._registry.register(plugin);
    }

    return rl;
  }
}

function findRunlineDir(from: string): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, ".runline"))) return join(dir, ".runline");
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
