import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { applyEnvOverrides, updateConnectionConfig } from "../config/loader.js";
import type { RunlineConfig } from "../config/types.js";
import type { PluginRegistry } from "../plugin/registry.js";
import {
  formatValidationError,
  helpInputs,
  isTypedInputSchema,
  validateTypedInput,
} from "../plugin/schema.js";
import type {
  ActionContext,
  ConnectionConfig,
  HelpInput,
  PluginDef,
} from "../plugin/types.js";

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs: string[];
}

export interface EngineOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
}

/**
 * One resolved action call, observed at the engine's dispatch point.
 *
 * Fired only around `action.execute()` — an unknown path or a failed
 * input validation throws before plugin code runs and is not an
 * invocation. `error` is present exactly when execute rejected: the
 * thrown value as-is, except a nullish throw, which is substituted
 * with an Error so failure is never mistaken for success. The hook
 * sees it in the host process even though the worker only ever
 * receives the message string.
 */
export interface ActionInvocation {
  plugin: string;
  action: string;
  /** The full callable path, "plugin.action". */
  path: string;
  durationMs: number;
  error?: unknown;
}

export interface EngineHooks {
  /**
   * Observer for every action invocation. Must not throw — but if it
   * does, the engine swallows it: observability never breaks a run.
   */
  onAction?: (info: ActionInvocation) => void;
}

// Messages worker → host. Every message carries the `runId` it belongs to so
// a straggler from a finished run can never be attributed to the next one on
// a reused worker.
//
// The id is an unguessable token, not a counter. A body can reach
// `require("node:worker_threads").parentPort` — the worker is an ergonomic
// surface, not a security sandbox — so with a predictable id it could forge a
// `done` for the *next* run and hand it a fabricated result. It cannot read
// the current id either: bodies are compiled with `new Function`, whose scope
// is the worker's global object, not the module scope holding `__runId`.
type WorkerMessage =
  | { t: "log"; runId: string; level: string; line: string }
  | { t: "invoke"; runId: string; id: number; path: string; args: unknown }
  | {
      t: "done";
      runId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
      /** Worker left timers behind — it must not be reused. */
      dirty?: boolean;
    };

// Messages host → worker
type HostMessage =
  | { t: "run"; runId: string; body: string }
  | { t: "result"; runId: string; id: number; ok: true; value: unknown }
  | { t: "result"; runId: string; id: number; ok: false; error: string };

/**
 * How many bodies one worker may run before it is retired.
 *
 * This is a memory dial, not a safety dial. Every recycle spawns a thread
 * whose arena the runtime never returns (~190KB), so the cap sets a floor on
 * the residual leak: measured over 100k executions, 50 costs 3.85 KB/run and
 * never plateaus, while an unbounded worker settles at 0.06 KB/run.
 *
 * It is not what keeps runs isolated. A body that leaves a timer, an
 * undeletable global, or a touched intrinsic retires its worker immediately
 * (see `dirty` in the worker source), so contamination never survives the run
 * that caused it. The cap only bounds hazards the detector cannot see, which
 * after descriptor-level intrinsic checking is a narrow set: prototype-chain
 * surgery and mutation of objects reachable but not enumerated.
 *
 * 500 keeps that backstop while cutting the residual leak ~10x.
 */
const DEFAULT_MAX_RUNS_PER_WORKER = 500;

interface PooledWorker {
  worker: Worker;
  /**
   * Everything baked into this worker at construction: the plugin surface in
   * its source and the resourceLimits it was given. A run whose shape differs
   * must not be handed this worker.
   */
  shape: string;
  runs: number;
  busy: boolean;
}

/**
 * Identity of a worker's immutable configuration.
 *
 * Must be a real digest, not a length or a count: a collision hands a run a
 * worker whose action surface or memory ceiling is not the one it asked for.
 */
function workerShape(
  pluginNames: string[],
  helpData: Record<string, HelpEntry[]>,
  memoryLimitMb: number,
): string {
  const surface = JSON.stringify([pluginNames, helpData]);
  // FNV-1a: no dependency, stable across processes, ample for a cache key.
  let hash = 0x811c9dc5;
  for (let i = 0; i < surface.length; i++) {
    hash ^= surface.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}:${surface.length}:${memoryLimitMb}`;
}

/**
 * Whether to arm the host-side RSS watchdog for a worker run.
 *
 * node enforces resourceLimits.maxOldGenerationSizeMb natively, and the
 * watchdog measures *whole-process* RSS — arming it there would risk false
 * kills from unrelated host allocations (e.g. a concurrent execute). bun
 * ignores resourceLimits, so the watchdog is the only memory backstop.
 */
export function shouldArmRssWatchdog(
  versions: Partial<Record<string, string>> = process.versions,
): boolean {
  return Boolean(versions.bun);
}

// Extra slack on top of the configured memory limit for the RSS watchdog,
// since whole-process RSS includes the host's own working set.
const RSS_WATCHDOG_SLACK_BYTES = 128 * 1024 * 1024;

/**
 * Executes agent code in a node:worker_threads worker.
 *
 * The worker is an ergonomic coding surface, not a security sandbox: agent
 * code gets the full host JS runtime (Buffer, crypto, etc.) plus injected
 * action proxies. Isolation properties we do enforce, fail-soft:
 *
 * - timeout: worker.terminate() — interrupts even `while(true){}`
 * - memory: resourceLimits.maxOldGenerationSizeMb (node) + an RSS-delta
 *   watchdog fallback; both surface as a clean "Memory limit exceeded" error
 * - crash containment: a dead worker never takes the host process down
 *
 * ## Why the worker is pooled
 *
 * Spawning a worker per execution leaks ~175KB of RSS per call under bun
 * (~55KB under node): the runtime does not return a dead thread's arena to
 * the OS, and there is no handle to free from JS — awaiting `terminate()`,
 * dropping listeners, and letting the worker exit naturally all still leak.
 * The only lever is to stop creating threads, so one worker serves many runs
 * (measured 187KB/run -> 4KB/run).
 *
 * Reuse is given up the moment it could be unsafe. A worker is retired on
 * timeout, crash, memory kill, plugin-surface change, leftover timers, or
 * after `maxRunsPerWorker` bodies. A run that arrives while the pooled worker
 * is busy gets its own throwaway worker, so concurrency semantics are
 * unchanged.
 */
export class ExecutionEngine {
  private registry: PluginRegistry;
  private config: RunlineConfig;
  private hooks: EngineHooks;
  private pooled: PooledWorker | null = null;
  private readonly maxRunsPerWorker: number;

  constructor(
    registry: PluginRegistry,
    config: RunlineConfig,
    hooks: EngineHooks = {},
  ) {
    this.registry = registry;
    this.config = config;
    this.hooks = hooks;
    this.maxRunsPerWorker =
      config.maxRunsPerWorker ?? DEFAULT_MAX_RUNS_PER_WORKER;
  }

  /** Retire the pooled worker, if any. Safe to call repeatedly. */
  dispose(): void {
    const entry = this.pooled;
    if (!entry) return;
    this.pooled = null;
    destroyWorker(entry.worker);
  }

  /**
   * Hand back a worker to run one body in.
   *
   * Prefers the pooled worker when it is idle and shaped correctly. Anything
   * else — wrong shape, quota spent, or already busy — gets a fresh worker.
   * A worker created because the pool was occupied stays private to that run
   * (`pooled` is false) and is destroyed when the run ends, so overlapping
   * callers keep the parallelism they had before pooling existed.
   */
  private acquire(
    shape: string,
    build: () => Worker,
  ): { entry: PooledWorker; pooled: boolean } {
    const idle = this.pooled && !this.pooled.busy ? this.pooled : null;
    if (idle && (idle.shape !== shape || idle.runs >= this.maxRunsPerWorker)) {
      this.dispose();
    } else if (idle) {
      return { entry: idle, pooled: true };
    }

    const entry: PooledWorker = {
      worker: build(),
      shape,
      runs: 0,
      busy: false,
    };
    // An idle pooled worker must not hold the host's event loop open, or a
    // one-shot CLI would never exit. The per-run timeout timer keeps the loop
    // alive for the duration of an actual run.
    entry.worker.unref?.();
    if (!this.pooled) {
      this.pooled = entry;
      return { entry, pooled: true };
    }
    return { entry, pooled: false };
  }

  /**
   * Finish with a worker. `retire` means the worker is no longer trustworthy
   * — anything other than a clean completion. Private (non-pooled) workers
   * are always destroyed.
   */
  private release(entry: PooledWorker, pooled: boolean, retire: boolean): void {
    entry.busy = false;
    if (!pooled || retire) {
      if (this.pooled === entry) this.pooled = null;
      destroyWorker(entry.worker);
    }
  }

  async execute(code: string, options?: EngineOptions): Promise<ExecuteResult> {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;
    const memoryLimitBytes =
      options?.memoryLimitBytes ?? this.config.memoryLimitBytes;
    const logs: string[] = [];

    const plugins = this.registry.listPlugins();
    const pluginNames = plugins.map((p) => p.name);
    const helpData = buildHelpData(plugins);
    const memoryLimitMb = Math.max(
      8,
      Math.floor(memoryLimitBytes / (1024 * 1024)),
    );
    // resourceLimits are fixed at construction, so a run asking for a
    // different ceiling must not inherit an existing worker's.
    const shape = workerShape(pluginNames, helpData, memoryLimitMb);
    const body = buildRunBody(code);

    let acquired: { entry: PooledWorker; pooled: boolean };
    try {
      acquired = this.acquire(
        shape,
        () =>
          new Worker(buildWorkerSource(pluginNames, helpData), {
            eval: true,
            resourceLimits: { maxOldGenerationSizeMb: memoryLimitMb },
          }),
      );
    } catch (err) {
      return { result: null, error: formatError(err), logs };
    }
    const { entry, pooled } = acquired;

    return new Promise<ExecuteResult>((resolve) => {
      const worker = entry.worker;
      const runId = newRunId();
      entry.busy = true;
      entry.runs++;

      let settled = false;
      const finish = (r: ExecuteResult, retire: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        clearInterval(rssTimer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        this.release(entry, pooled, retire);
        resolve(r);
      };

      // A spinning body blocks the worker's event loop, so it can never be
      // asked to stop — terminate is the only remedy and the worker is gone.
      const timeoutTimer = setTimeout(() => {
        finish(
          {
            result: null,
            error: `Execution timed out after ${timeoutMs}ms`,
            logs,
          },
          true,
        );
      }, timeoutMs);

      let rssTimer: ReturnType<typeof setInterval> | undefined;
      if (shouldArmRssWatchdog()) {
        const baselineRss = process.memoryUsage().rss;
        rssTimer = setInterval(() => {
          const delta = process.memoryUsage().rss - baselineRss;
          if (delta > memoryLimitBytes + RSS_WATCHDOG_SLACK_BYTES) {
            finish(
              {
                result: null,
                error: `Memory limit exceeded (${memoryLimitMb}MB)`,
                logs,
              },
              true,
            );
          }
        }, 100);
        rssTimer.unref?.();
      }

      // A reply can race the worker's death; losing it is fine — the run is
      // over either way — but it must never surface as an unhandled
      // rejection in the host.
      const reply = (message: HostMessage) => {
        if (settled) return;
        try {
          worker.postMessage(message);
        } catch {
          // worker already gone
        }
      };

      const onMessage = (msg: WorkerMessage) => {
        if (settled) return;
        // Straggler from an earlier body on this same worker.
        if (msg.runId !== runId) return;
        if (msg.t === "log") {
          logs.push(`[${msg.level}] ${msg.line}`);
        } else if (msg.t === "invoke") {
          this.invokeAction(msg.path, msg.args).then(
            (value) => {
              let serialized: unknown;
              try {
                serialized = toPlainJson(value);
              } catch (err) {
                reply({
                  t: "result",
                  runId,
                  id: msg.id,
                  ok: false,
                  error: `Action result not JSON-serializable: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                });
                return;
              }
              reply({
                t: "result",
                runId,
                id: msg.id,
                ok: true,
                value: serialized,
              });
            },
            (err) => {
              reply({
                t: "result",
                runId,
                id: msg.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            },
          );
        } else if (msg.t === "done") {
          // A body that left timers running keeps consuming the worker's
          // event loop and can post into later runs: never reuse it.
          finish(
            msg.ok
              ? { result: msg.result, logs }
              : { result: null, error: msg.error ?? "Unknown error", logs },
            msg.dirty === true,
          );
        }
      };

      const onError = (err: NodeJS.ErrnoException) => {
        finish(
          {
            result: null,
            error:
              err.code === "ERR_WORKER_OUT_OF_MEMORY"
                ? `Memory limit exceeded (${memoryLimitMb}MB)`
                : formatError(err),
            logs,
          },
          true,
        );
      };

      const onExit = (exitCode: number) => {
        finish(
          {
            result: null,
            error: `Worker exited unexpectedly (code ${exitCode})`,
            logs,
          },
          true,
        );
      };

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);

      reply({ t: "run", runId, body });
    });
  }

  private async invokeAction(path: string, args: unknown): Promise<unknown> {
    const resolved = this.registry.resolveAction(path);
    if (!resolved) {
      throw new Error(`Unknown action: ${path}${this.selfPrefixHint(path)}`);
    }

    const { plugin, action } = resolved;
    const connection = this.resolveConnection(plugin);
    const ctx: ActionContext = {
      connection,
      log: {
        info: (msg) => console.log(`[${plugin.name}] ${msg}`),
        warn: (msg) => console.warn(`[${plugin.name}] ${msg}`),
        error: (msg) => console.error(`[${plugin.name}] ${msg}`),
      },
      updateConnection: async (patch) => {
        // Mutate the in-memory copy so the rest of this action
        // sees the new values without re-reading disk.
        Object.assign(connection.config, patch);
        await updateConnectionConfig(connection.name, patch);
      },
    };

    if (isTypedInputSchema(action.inputSchema)) {
      const validation = validateTypedInput(action.inputSchema, args);
      if (!validation.ok) {
        throw new Error(formatValidationError(path, validation));
      }
    }

    const started = performance.now();
    try {
      const value = await action.execute(args, ctx);
      this.fireOnAction(plugin.name, action.name, path, started, false);
      return value;
    } catch (err) {
      // `failed` is a flag, not `error !== undefined` — a plugin that
      // does `throw undefined` still failed.
      this.fireOnAction(plugin.name, action.name, path, started, true, err);
      throw err;
    }
  }

  private fireOnAction(
    pluginName: string,
    actionName: string,
    path: string,
    started: number,
    failed: boolean,
    error?: unknown,
  ): void {
    const onAction = this.hooks.onAction;
    if (!onAction) return;
    try {
      onAction({
        plugin: pluginName,
        action: actionName,
        path,
        durationMs: performance.now() - started,
        ...(failed ? { error: error ?? new Error("Unknown error") } : {}),
      });
    } catch {
      // Observability never breaks a run.
    }
  }

  /**
   * A miss on "salesforce.status" is often a plugin that registered
   * its action name with the plugin prefix ("salesforce.status" inside
   * plugin "salesforce"), making the real path
   * "salesforce.salesforce.status". Detect exactly that shape and
   * teach the caller — agents read error messages and self-correct.
   */
  private selfPrefixHint(path: string): string {
    // A dot-less miss can still be the exact-name case: plugin "ping"
    // registering action "ping" makes the callable path "ping.ping".
    const dot = path.indexOf(".");
    const pluginName = dot < 0 ? path : path.slice(0, dot);
    const doubled = `${pluginName}.${path}`;
    if (!this.registry.resolveAction(doubled)) return "";
    return (
      `. Did you mean "${doubled}"? Plugin "${pluginName}" registered its ` +
      `action name with the plugin prefix ("${path}"), so the full callable ` +
      `path is "${doubled}".`
    );
  }

  private resolveConnection(plugin: PluginDef): ConnectionConfig {
    const conn = this.config.connections.find((c) => c.plugin === plugin.name);
    const base = conn ?? {
      name: "default",
      plugin: plugin.name,
      config: {},
    };
    return applyEnvOverrides(base, plugin.connectionConfigSchema);
  }
}

// ── Helpers ──────────────────────────────

/**
 * Drop every listener before terminating: a worker being torn down can still
 * emit `exit`, and a stale handler would resolve a run that already settled.
 */
function destroyWorker(worker: Worker): void {
  worker.removeAllListeners();
  void worker.terminate();
}

/** Unguessable per-run token. See the WorkerMessage comment for why. */
function newRunId(): string {
  return randomUUID();
}

/**
 * JSON round-trip to (a) guarantee structured-clone compatibility and
 * (b) preserve the previous engine's value semantics, where every action
 * result crossed a JSON boundary (Dates → ISO strings, no Maps, etc.).
 */
function toPlainJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.stack ?? cause.message;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof (cause as { message: unknown }).message === "string"
  ) {
    return (cause as { message: string }).message;
  }
  return String(cause);
}

// ferrosearch is a Rust native addon, so unlike the old minisearch UMD it
// cannot be inlined into the worker source as text. Resolve its entry point
// host-side and require it by absolute path inside the worker: eval'd worker
// code gets a cwd-relative `require`, so a bare specifier would resolve
// against the caller's cwd instead of runline's own node_modules.
const ferrosearchPath = createRequire(import.meta.url).resolve(
  "@shift-labs/ferrosearch",
);

interface HelpEntry {
  action: string;
  access?: "read" | "write";
  description?: string;
  inputs: Record<string, HelpInput>;
}

function buildHelpData(plugins: PluginDef[]): Record<string, HelpEntry[]> {
  const data: Record<string, HelpEntry[]> = {};
  for (const p of plugins) {
    data[p.name] = p.actions.map((a) => ({
      action: a.name,
      access: a.access,
      description: a.description,
      inputs: helpInputs(a.inputSchema),
    }));
  }
  return data;
}

/**
 * Normalize a caller's code into a function body. Kept host-side so the
 * worker source carries no user code and can therefore be reused.
 *
 * Exported for tests: this is the one place the "bare expression vs arrow
 * function" calling convention is decided.
 */
export function buildRunBody(code: string): string {
  const trimmed = code.trim();
  const looksLikeArrow =
    (trimmed.startsWith("async") || trimmed.startsWith("(")) &&
    trimmed.includes("=>");

  return looksLikeArrow
    ? `const __fn = (${trimmed});\nif (typeof __fn !== 'function') throw new Error('Code must evaluate to a function');\nreturn await __fn();`
    : code;
}

function buildWorkerSource(
  pluginNames: string[] = [],
  helpData: Record<string, HelpEntry[]> = {},
): string {
  // Injected into every body's scope. `require` is here because bodies are
  // compiled with `new Function`, whose scope is the worker's *global* object
  // — not the module scope that used to hold the inlined body. Without it,
  // pooling would silently revoke a documented capability ("agent code gets
  // the full host JS runtime") as a side effect of a memory fix.
  const injectNames = [
    ...pluginNames,
    "actions",
    "console",
    "fetch",
    "require",
    "FerroSearch",
  ];

  const wrapped = `"use strict";
const { parentPort: __port } = require("node:worker_threads");

// process.exit would be runtime-divergent here: node kills the worker
// synchronously, bun lets the completion message race the exit and can
// report a silent undefined success. Make it a regular, catchable error.
process.exit = (code) => {
  throw new Error('process.exit(' + (code ?? 0) + ') is not available in the runline sandbox; return a value instead');
};

// ── run state ──
// This worker outlives any single body, so everything the host correlates
// on is scoped to __runId, an unguessable token supplied by the host.
let __runId = null;

// ── timer tracking ──
// A body that leaves a timer behind keeps consuming this worker's event
// loop and can fire into a later run. Count outstanding handles so the host
// can retire the worker instead of reusing it.
let __liveTimers = 0;
const __realSetTimeout = setTimeout;
const __realSetInterval = setInterval;
const __realClearTimeout = clearTimeout;
const __realClearInterval = clearInterval;
const __timerHandles = new Set();
globalThis.setTimeout = function (fn, ms, ...rest) {
  let h;
  const wrapped = (...a) => {
    if (__timerHandles.delete(h)) __liveTimers--;
    return fn(...a);
  };
  h = __realSetTimeout(wrapped, ms, ...rest);
  __timerHandles.add(h);
  __liveTimers++;
  return h;
};
globalThis.setInterval = function (fn, ms, ...rest) {
  const h = __realSetInterval(fn, ms, ...rest);
  __timerHandles.add(h);
  __liveTimers++;
  return h;
};
globalThis.clearTimeout = function (h) {
  if (__timerHandles.delete(h)) __liveTimers--;
  return __realClearTimeout(h);
};
globalThis.clearInterval = function (h) {
  if (__timerHandles.delete(h)) __liveTimers--;
  return __realClearInterval(h);
};

// ── host bridge ──
let __seq = 0;
const __pending = new Map();
const __invoke = (path, args) => new Promise((resolve, reject) => {
  const id = ++__seq;
  __pending.set(id, { resolve, reject });
  try {
    __port.postMessage({ t: "invoke", runId: __runId, id, path, args });
  } catch (e) {
    __pending.delete(id);
    reject(e);
  }
});
const __log = (level, line) => {
  try { __port.postMessage({ t: "log", runId: __runId, level, line }); } catch {}
};

const __fmt = (v) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

const __fmtErr = (e) => {
  if (e && typeof e === 'object') {
    const m = typeof e.message === 'string' ? e.message : '';
    const st = typeof e.stack === 'string' ? e.stack : '';
    if (m && st) return st.indexOf(m) === -1 ? m + '\\n' + st : st;
    if (m) return m;
    if (st) return st;
  }
  return String(e);
};

// JSON round-trip mirrors the host's toPlainJson: keeps results
// structured-clone-safe and preserves JSON value semantics.
const __toJson = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

// ferrosearch native addon, resolved to an absolute path by the host. Its
// index memory lives outside the V8 heap, which is the point — minisearch's
// JS index counted against maxOldGenerationSizeMb and grew worker RSS — but
// also means an index built by agent code is invisible to that limit.
const { FerroSearch } = require(${JSON.stringify(ferrosearchPath)});

const __help = ${JSON.stringify(helpData)};

const __makeProxy = (path = []) => new Proxy(() => undefined, {
  get(_t, prop) {
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    return __makeProxy([...path, String(prop)]);
  },
  apply(_t, _this, args) {
    const p = path.join('.');
    if (!p) throw new Error('Action path missing');
    return __invoke(p, args[0]);
  },
});

// Flat index of every "plugin.action" path → { plugin, entry }
const __index = (() => {
  const out = Object.create(null);
  for (const plugin of Object.keys(__help)) {
    for (const e of __help[plugin]) {
      out[plugin + '.' + e.action] = { plugin, entry: e };
    }
  }
  return out;
})();

const __formatSignature = (plugin, entry) => {
  const fields = Object.entries(entry.inputs || {})
    .map(([k, v]) => k + (v.required ? '' : '?') + ': ' + (v.displayType || v.type))
    .join(', ');
  return plugin + '.' + entry.action + (fields ? '({ ' + fields + ' })' : '()');
};

// Build a FerroSearch index over every action path. Indexed at worker
// startup, queried by actions.find().
const __search = (() => {
  const docs = [];
  for (const path of Object.keys(__index)) {
    const { plugin, entry } = __index[path];
    docs.push({
      id: path,
      path,
      plugin,
      action: entry.action,
      description: entry.description || '',
    });
  }
  const index = new FerroSearch({
    fields: ['path', 'plugin', 'action', 'description'],
    storeFields: ['path', 'description'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { path: 3, action: 2, plugin: 2 },
    },
  });
  index.addAll(docs);
  return index;
})();

const __actionsApi = {
  list(plugin) {
    const paths = Object.keys(__index);
    return plugin ? paths.filter((p) => p.startsWith(plugin + '.')) : paths;
  },
  describe(path) {
    const hit = __index[path];
    if (!hit) {
      const near = __actionsApi.find(path, 3);
      const hint = near.length ? ' Did you mean: ' + near.map((n) => n.path).join(', ') + '?' : '';
      throw new Error('Unknown action: ' + path + '.' + hint);
    }
    return {
      path,
      plugin: hit.plugin,
      action: hit.entry.action,
      access: hit.entry.access,
      description: hit.entry.description,
      signature: __formatSignature(hit.plugin, hit.entry),
      inputs: hit.entry.inputs,
    };
  },
  find(query, limit = 5) {
    const q = String(query || '').trim();
    if (!q) return [];
    return __search.search(q).slice(0, limit).map((r) => ({
      path: r.path,
      access: __index[r.path]?.entry?.access,
      description: r.description || undefined,
      score: r.score,
    }));
  },
  check(path, args) {
    const hit = __index[path];
    if (!hit) {
      const near = __actionsApi.find(path, 3).map((n) => n.path);
      return { ok: false, error: 'Unknown action: ' + path, suggestions: near };
    }
    const inputs = hit.entry.inputs || {};
    const provided = args && typeof args === 'object' ? args : {};
    const missing = [];
    const unknown = [];
    const typeErrors = [];
    for (const [k, spec] of Object.entries(inputs)) {
      if (spec.required && !(k in provided)) missing.push(k);
    }
    for (const k of Object.keys(provided)) {
      if (!(k in inputs)) unknown.push(k);
      else {
        const spec = inputs[k];
        const expected = spec.type;
        const actual = Array.isArray(provided[k]) ? 'array' : provided[k] === null ? 'null' : typeof provided[k];
        if (provided[k] !== null && provided[k] !== undefined && expected !== actual) {
          typeErrors.push({ field: k, expected: spec.displayType || expected, actual });
        } else if (spec.enum && !spec.enum.includes(provided[k])) {
          typeErrors.push({ field: k, expected: spec.enum.map(String).join(' | '), actual: __fmt(provided[k]) });
        } else if ('const' in spec && provided[k] !== spec.const) {
          typeErrors.push({ field: k, expected: __fmt(spec.const), actual: __fmt(provided[k]) });
        }
      }
    }
    return {
      ok: missing.length === 0 && unknown.length === 0 && typeErrors.length === 0,
      missing,
      unknown,
      typeErrors,
      signature: __formatSignature(hit.plugin, hit.entry),
    };
  },
};

// Unknown keys (plugin names) fall through to the call proxy, so
// actions.github.issue.create(...) keeps working alongside the explicit
// list/find/describe/check/help helpers.
const actions = new Proxy(__actionsApi, {
  get(target, prop) {
    if (prop in target || typeof prop === 'symbol') return target[prop];
    return __makeProxy([String(prop)]);
  },
});

${pluginNames.map((n) => `const ${n} = __makeProxy(['${n}']);`).join("\n")}

const console = {
  log: (...a) => __log('log', a.map(__fmt).join(' ')),
  warn: (...a) => __log('warn', a.map(__fmt).join(' ')),
  error: (...a) => __log('error', a.map(__fmt).join(' ')),
  info: (...a) => __log('info', a.map(__fmt).join(' ')),
  debug: (...a) => __log('debug', a.map(__fmt).join(' ')),
};

const fetch = () => { throw new Error('fetch is disabled in runline sandbox'); };

// Stable identity for this worker instance. Set before the baseline snapshot
// so the scrub never removes it. Thread ids are recycled by the runtime and
// cannot be used to tell one worker from the next; this can.
globalThis.__runlineWorkerId =
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);

// ── cross-run contamination ──
//
// Two shapes, one policy: anything a body leaves behind that the next body
// could observe makes this worker untrustworthy. Removable state is removed;
// unremovable state retires the worker. Nothing is left for the next run to
// trip over.

// 1. Own properties added to globalThis. Removable — delete them.
const __baselineGlobals = new Set(Object.getOwnPropertyNames(globalThis));

// 2. Mutations to shared intrinsics (Array.prototype.push = ..., a new own
//    property on Object, etc). NOT removable: restoring an arbitrary mutation
//    would mean snapshotting every descriptor of every intrinsic. Instead
//    fingerprint their own-property names and compare — a change means the
//    body reshaped something shared and the worker must not be reused.
const __intrinsics = [
  Object, Object.prototype, Array, Array.prototype, Function.prototype,
  String.prototype, Number.prototype, Boolean.prototype, Promise,
  Promise.prototype, Map.prototype, Set.prototype, Date.prototype,
  RegExp.prototype, Error.prototype, JSON, Math, Reflect,
];
// Snapshot of every intrinsic's own data properties, by reference. Taken
// once; compared after each run. Catches BOTH shapes of tampering:
//   - additions/removals  (the own-name set changes)
//   - replacements        (Array.prototype.push = fn — same name, new value)
// A name-only fingerprint misses the second, which is the more likely
// monkey-patch. Descriptors are read rather than the properties themselves so
// accessor getters are never invoked here.
const __snapshot = [];
for (const target of __intrinsics) {
  let names;
  try { names = Object.getOwnPropertyNames(target); } catch { continue; }
  for (const n of names) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(target, n); } catch { continue; }
    if (!d) continue;
    // Accessors are recorded by their get/set identity, data props by value.
    __snapshot.push([target, n, "value" in d ? d.value : d.get, names.length]);
  }
}

const __intrinsicsIntact = () => {
  for (let i = 0; i < __snapshot.length; i++) {
    const [target, name, expected] = __snapshot[i];
    let d;
    try { d = Object.getOwnPropertyDescriptor(target, name); } catch { return false; }
    if (!d) return false;
    if (("value" in d ? d.value : d.get) !== expected) return false;
  }
  // Additions are caught by the own-name count, which is recorded per target
  // alongside each of its entries.
  for (let i = 0; i < __snapshot.length; i++) {
    const [target, , , count] = __snapshot[i];
    let names;
    try { names = Object.getOwnPropertyNames(target); } catch { return false; }
    if (names.length !== count) return false;
  }
  return true;
};

/**
 * Returns true when this worker is still safe to reuse. Removes what it can;
 * reports what it cannot.
 */
const __scrubGlobals = () => {
  let clean = true;

  // Assigning parentPort.onmessage is a setter-based route to the host
  // channel; restore it and distrust the worker. See __bodyRequire.
  if (__port.onmessage !== __baselineOnMessage) {
    __port.onmessage = __baselineOnMessage;
    clean = false;
  }
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    if (__baselineGlobals.has(k)) continue;
    try {
      delete globalThis[k];
    } catch {
      clean = false;
    }
    // A non-configurable property survives a silent delete: verify, don't
    // assume the absence of a throw means success.
    if (Object.prototype.hasOwnProperty.call(globalThis, k)) clean = false;
  }
  if (!__intrinsicsIntact()) clean = false;
  return clean;
};

// The host channel is the one capability a body must not hold.
//
// A body can require("node:worker_threads"). Before pooling that was
// harmless: anything it attached died with the worker after a single run.
// Under reuse a surviving listener sees the {t:"run", runId} of EVERY later
// body and can post a forged "done" for it, handing that run attacker-chosen
// output. Randomising the run id does not help — the listener is simply told
// what it is.
//
// Bun's MessagePort exposes no listenerCount/removeAllListeners, so listeners
// cannot be enumerated and stripped after the fact. Instead the route in is
// closed: the require handed to bodies returns a worker_threads module with
// the port fields blanked. Every other module, and everything else about this
// one, is untouched.
const __bodyRequire = (id) => {
  const mod = require(id);
  if (id === "worker_threads" || id === "node:worker_threads") {
    return Object.freeze({
      ...mod,
      parentPort: null,
      receiveMessageOnPort: undefined,
    });
  }
  return mod;
};

// Names injected into every body's scope. Passing them as parameters gives
// each run a fresh function scope, so top-level declarations in user code
// cannot collide across runs.
const __injectNames = ${JSON.stringify(injectNames)};
const __injectValues = __injectNames.map((n) => {
  switch (n) {
    case "actions": return actions;
    case "console": return console;
    case "fetch": return fetch;
    case "require": return __bodyRequire;
    case "FerroSearch": return FerroSearch;
    default: return __makeProxy([n]);
  }
});

// One body, start to finish. Never throws: every outcome is a "done".
const __baselineOnMessage = __port.onmessage;

const __run = async (runId, body) => {
  __runId = runId;
  __pending.clear();
  let msg;
  try {
    const fn = new Function(
      ...__injectNames,
      '"use strict"; return (async () => {\\n' + body + '\\n})();',
    );
    const v = await fn(...__injectValues);
    msg = { t: "done", runId, ok: true, result: __toJson(v) };
  } catch (e) {
    msg = { t: "done", runId, ok: false, error: __fmtErr(e) };
  }
  // Scrub before reporting so the host's reuse decision and the worker's
  // actual state agree. Dirty means "do not reuse me": a leftover timer, a
  // global that would not delete, or a mutated shared intrinsic.
  const __clean = __scrubGlobals();
  msg.dirty = __liveTimers > 0 || !__clean;
  try {
    __port.postMessage(msg);
  } catch (e) {
    __port.postMessage({
      t: "done",
      runId,
      ok: false,
      error: __fmtErr(e),
      dirty: true,
    });
  }
};

function __hostMessageHandler(m) {
  if (!m) return;
  if (m.t === "run") {
    void __run(m.runId, m.body);
    return;
  }
  if (m.t !== "result") return;
  // Replies for a superseded run are dropped: its promises are gone.
  if (m.runId !== __runId) return;
  const p = __pending.get(m.id);
  if (!p) return;
  __pending.delete(m.id);
  if (m.ok) p.resolve(m.value);
  else p.reject(new Error(m.error));
}
__port.on("message", __hostMessageHandler);
`;

  return wrapped;
}
