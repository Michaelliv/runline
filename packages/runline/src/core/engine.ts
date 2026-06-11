import { readFileSync } from "node:fs";
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

// Messages worker → host
type WorkerMessage =
  | { t: "log"; level: string; line: string }
  | { t: "invoke"; id: number; path: string; args: unknown }
  | { t: "done"; ok: boolean; result?: unknown; error?: string };

// Messages host → worker (action invocation replies)
type InvokeReply =
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string };

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
 * - crash containment: a dead worker never takes the host process down, and
 *   each execute() gets a fresh worker, so the engine stays usable
 */
export class ExecutionEngine {
  private registry: PluginRegistry;
  private config: RunlineConfig;

  constructor(registry: PluginRegistry, config: RunlineConfig) {
    this.registry = registry;
    this.config = config;
  }

  async execute(code: string, options?: EngineOptions): Promise<ExecuteResult> {
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;
    const memoryLimitBytes =
      options?.memoryLimitBytes ?? this.config.memoryLimitBytes;
    const logs: string[] = [];

    const plugins = this.registry.listPlugins();
    const source = buildWorkerSource(
      code,
      plugins.map((p) => p.name),
      buildHelpData(plugins),
    );

    return new Promise<ExecuteResult>((resolve) => {
      const memoryLimitMb = Math.max(
        8,
        Math.floor(memoryLimitBytes / (1024 * 1024)),
      );
      let worker: Worker;
      try {
        worker = new Worker(source, {
          eval: true,
          resourceLimits: { maxOldGenerationSizeMb: memoryLimitMb },
        });
      } catch (err) {
        resolve({ result: null, error: formatError(err), logs });
        return;
      }

      let settled = false;
      const finish = (r: ExecuteResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        clearInterval(rssTimer);
        void worker.terminate();
        resolve(r);
      };

      const timeoutTimer = setTimeout(() => {
        finish({
          result: null,
          error: `Execution timed out after ${timeoutMs}ms`,
          logs,
        });
      }, timeoutMs);

      let rssTimer: ReturnType<typeof setInterval> | undefined;
      if (shouldArmRssWatchdog()) {
        const baselineRss = process.memoryUsage().rss;
        rssTimer = setInterval(() => {
          const delta = process.memoryUsage().rss - baselineRss;
          if (delta > memoryLimitBytes + RSS_WATCHDOG_SLACK_BYTES) {
            finish({
              result: null,
              error: `Memory limit exceeded (${memoryLimitMb}MB)`,
              logs,
            });
          }
        }, 100);
        rssTimer.unref?.();
      }

      // A reply can race the worker's death; losing it is fine — the run is
      // over either way — but it must never surface as an unhandled
      // rejection in the host.
      const reply = (message: InvokeReply) => {
        if (settled) return;
        try {
          worker.postMessage(message);
        } catch {
          // worker already gone
        }
      };

      worker.on("message", (msg: WorkerMessage) => {
        if (settled) return;
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
                  id: msg.id,
                  ok: false,
                  error: `Action result not JSON-serializable: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                });
                return;
              }
              reply({ t: "result", id: msg.id, ok: true, value: serialized });
            },
            (err) => {
              reply({
                t: "result",
                id: msg.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            },
          );
        } else if (msg.t === "done") {
          finish(
            msg.ok
              ? { result: msg.result, logs }
              : { result: null, error: msg.error ?? "Unknown error", logs },
          );
        }
      });

      worker.on("error", (err: NodeJS.ErrnoException) => {
        finish({
          result: null,
          error:
            err.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? `Memory limit exceeded (${memoryLimitMb}MB)`
              : formatError(err),
          logs,
        });
      });

      worker.on("exit", (exitCode) => {
        finish({
          result: null,
          error: `Worker exited unexpectedly (code ${exitCode})`,
          logs,
        });
      });
    });
  }

  private async invokeAction(path: string, args: unknown): Promise<unknown> {
    const resolved = this.registry.resolveAction(path);
    if (!resolved) {
      throw new Error(`Unknown action: ${path}`);
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

    return action.execute(args, ctx);
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

// ── Helpers ──────────────────────────────────────────────

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

// MiniSearch UMD bundle, vendored at the package root and inlined into the
// worker source. Inside the worker it is evaluated in a local scope with a
// fresh `module`/`exports` pair so the UMD takes its CommonJS branch.
//
// `../../vendor/...` resolves identically from src/core/engine.ts (dev) and
// dist/core/engine.js (published) because tsc preserves the `core/` subdir.
// See vendor/README.md for the upgrade procedure.
const minisearchSource = readFileSync(
  new URL("../../vendor/minisearch.umd.js", import.meta.url),
  "utf8",
);

interface HelpEntry {
  action: string;
  description?: string;
  inputs: Record<string, HelpInput>;
}

function buildHelpData(plugins: PluginDef[]): Record<string, HelpEntry[]> {
  const data: Record<string, HelpEntry[]> = {};
  for (const p of plugins) {
    data[p.name] = p.actions.map((a) => ({
      action: a.name,
      description: a.description,
      inputs: helpInputs(a.inputSchema),
    }));
  }
  return data;
}

function buildWorkerSource(
  code: string,
  pluginNames: string[] = [],
  helpData: Record<string, HelpEntry[]> = {},
): string {
  const trimmed = code.trim();
  const looksLikeArrow =
    (trimmed.startsWith("async") || trimmed.startsWith("(")) &&
    trimmed.includes("=>");

  const body = looksLikeArrow
    ? `const __fn = (${trimmed});\nif (typeof __fn !== 'function') throw new Error('Code must evaluate to a function');\nreturn await __fn();`
    : code;

  const wrapped = `"use strict";
const { parentPort: __port } = require("node:worker_threads");

// process.exit would be runtime-divergent here: node kills the worker
// synchronously, bun lets the completion message race the exit and can
// report a silent undefined success. Make it a regular, catchable error.
process.exit = (code) => {
  throw new Error('process.exit(' + (code ?? 0) + ') is not available in the runline sandbox; return a value instead');
};

// ── host bridge ──
let __seq = 0;
const __pending = new Map();
__port.on("message", (m) => {
  if (!m || m.t !== "result") return;
  const p = __pending.get(m.id);
  if (!p) return;
  __pending.delete(m.id);
  if (m.ok) p.resolve(m.value);
  else p.reject(new Error(m.error));
});
const __invoke = (path, args) => new Promise((resolve, reject) => {
  const id = ++__seq;
  __pending.set(id, { resolve, reject });
  try {
    __port.postMessage({ t: "invoke", id, path, args });
  } catch (e) {
    __pending.delete(id);
    reject(e);
  }
});
const __log = (level, line) => {
  try { __port.postMessage({ t: "log", level, line }); } catch {}
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

// Inlined MiniSearch UMD, evaluated with a local module/exports so the UMD
// takes its CommonJS branch regardless of the worker's module scope.
const MiniSearch = (function () {
  const module = { exports: {} };
  const exports = module.exports;
  ${minisearchSource}
  return module.exports;
})();

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

// Build a MiniSearch index over every action path. Indexed at worker
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
  const ms = new MiniSearch({
    fields: ['path', 'plugin', 'action', 'description'],
    storeFields: ['path', 'description'],
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      boost: { path: 3, action: 2, plugin: 2 },
    },
  });
  ms.addAll(docs);
  return ms;
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

(async () => {
${body}
})().then(
  (v) => {
    try {
      __port.postMessage({ t: "done", ok: true, result: __toJson(v) });
    } catch (e) {
      __port.postMessage({ t: "done", ok: false, error: __fmtErr(e) });
    }
  },
  (e) => {
    __port.postMessage({ t: "done", ok: false, error: __fmtErr(e) });
  },
);
`;

  return wrapped;
}
