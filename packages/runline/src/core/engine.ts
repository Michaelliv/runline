import { readFileSync } from "node:fs";
import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten";
import { applyEnvOverrides, updateConnectionConfig } from "../config/loader.js";
import type { RunlineConfig } from "../config/types.js";
import type { PluginRegistry } from "../plugin/registry.js";
import type {
  ActionContext,
  ConnectionConfig,
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
    const deadlineMs = Date.now() + timeoutMs;
    const logs: string[] = [];
    const pendingDeferreds = new Set<QuickJSDeferredPromise>();

    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();

    try {
      runtime.setMemoryLimit(memoryLimitBytes);
      runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadlineMs));

      const context = runtime.newContext();
      try {
        // Inject log bridge
        const logBridge = context.newFunction(
          "__runline_log",
          (levelHandle, lineHandle) => {
            const level = context.getString(levelHandle);
            const line = context.getString(lineHandle);
            logs.push(`[${level}] ${line}`);
            return context.undefined;
          },
        );
        context.setProp(context.global, "__runline_log", logBridge);
        logBridge.dispose();

        // Inject action bridge
        const actionBridge = context.newFunction(
          "__runline_invoke",
          (pathHandle, argsHandle) => {
            const path = context.getString(pathHandle);
            const args =
              argsHandle === undefined ||
              context.typeof(argsHandle) === "undefined"
                ? undefined
                : context.dump(argsHandle);

            const deferred = context.newPromise();
            pendingDeferreds.add(deferred);
            deferred.settled.finally(() => pendingDeferreds.delete(deferred));

            this.invokeAction(path, args).then(
              (value) => {
                if (!deferred.alive) return;
                if (value === undefined) {
                  deferred.resolve();
                  return;
                }
                const serialized = JSON.stringify(value);
                const handle = context.newString(serialized);
                deferred.resolve(handle);
                handle.dispose();
              },
              (err) => {
                if (!deferred.alive) return;
                const msg = err instanceof Error ? err.message : String(err);
                const handle = context.newError(msg);
                deferred.reject(handle);
                handle.dispose();
              },
            );

            return deferred.handle;
          },
        );
        context.setProp(context.global, "__runline_invoke", actionBridge);
        actionBridge.dispose();

        const plugins = this.registry.listPlugins();
        const pluginNames = plugins.map((p) => p.name);
        const helpData = buildHelpData(plugins);
        const source = buildExecutionSource(code, pluginNames, helpData);

        const evaluated = context.evalCode(source, "runline-sandbox.js");
        if (evaluated.error) {
          const error = context.dump(evaluated.error);
          evaluated.error.dispose();
          return { result: null, error: formatError(error), logs };
        }

        // Set up promise tracking
        context.setProp(context.global, "__runline_result", evaluated.value);
        evaluated.value.dispose();

        const stateResult = context.evalCode(
          `(function(p){ var s = { v: void 0, e: void 0, settled: false };
           var fmtErr = function(e){ if (e && typeof e === 'object') { var m = typeof e.message === 'string' ? e.message : ''; var st = typeof e.stack === 'string' ? e.stack : ''; if (m && st) return st.indexOf(m) === -1 ? m + '\\n' + st : st; if (m) return m; if (st) return st; } return String(e); };
           p.then(function(v){ s.v = v; s.settled = true; }, function(e){ s.e = fmtErr(e); s.settled = true; }); return s; })(__runline_result)`,
        );

        if (stateResult.error) {
          const error = context.dump(stateResult.error);
          stateResult.error.dispose();
          return { result: null, error: formatError(error), logs };
        }

        const stateHandle = stateResult.value;
        try {
          await this.drainAsync(
            context,
            runtime,
            pendingDeferreds,
            deadlineMs,
            timeoutMs,
          );

          const settled = readProp(context, stateHandle, "settled") === true;
          if (!settled) {
            return {
              result: null,
              error: `Execution timed out after ${timeoutMs}ms`,
              logs,
            };
          }

          const error = readProp(context, stateHandle, "e");
          if (error !== undefined) {
            return { result: null, error: formatError(error), logs };
          }

          return { result: readProp(context, stateHandle, "v"), logs };
        } finally {
          stateHandle.dispose();
        }
      } finally {
        for (const d of pendingDeferreds) {
          if (d.alive) d.dispose();
        }
        pendingDeferreds.clear();
        context.dispose();
      }
    } catch (err) {
      return {
        result: null,
        error: formatError(err),
        logs,
      };
    } finally {
      runtime.dispose();
    }
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

  private async drainAsync(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    pendingDeferreds: ReadonlySet<QuickJSDeferredPromise>,
    deadlineMs: number,
    timeoutMs: number,
  ): Promise<void> {
    this.drainJobs(context, runtime, deadlineMs, timeoutMs);

    while (pendingDeferreds.size > 0) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Execution timed out after ${timeoutMs}ms`);
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.race([...pendingDeferreds].map((d) => d.settled)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
              remainingMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      this.drainJobs(context, runtime, deadlineMs, timeoutMs);
    }

    this.drainJobs(context, runtime, deadlineMs, timeoutMs);
  }

  private drainJobs(
    context: QuickJSContext,
    runtime: QuickJSRuntime,
    deadlineMs: number,
    timeoutMs: number,
  ): void {
    while (runtime.hasPendingJob()) {
      if (Date.now() >= deadlineMs) {
        throw new Error(`Execution timed out after ${timeoutMs}ms`);
      }
      const pending = runtime.executePendingJobs();
      if (pending.error) {
        const error = context.dump(pending.error);
        pending.error.dispose();
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

function readProp(
  context: QuickJSContext,
  handle: QuickJSHandle,
  key: string,
): unknown {
  const prop = context.getProp(handle, key);
  try {
    return context.dump(prop);
  } finally {
    prop.dispose();
  }
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
// sandbox source. UMD attaches `MiniSearch` to globalThis in a non-CJS /
// non-AMD env (QuickJS), so pasting the file is enough.
//
// `../../vendor/...` resolves identically from src/core/engine.ts (dev) and
// dist/core/engine.js (published) because tsc preserves the `core/` subdir.
// See vendor/README.md for the upgrade procedure.
const __minisearchSource = readFileSync(
  new URL("../../vendor/minisearch.umd.js", import.meta.url),
  "utf8",
);

interface HelpInput {
  type: string;
  required: boolean;
  description?: string;
}

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
      inputs: Object.fromEntries(
        Object.entries(a.inputSchema ?? {}).map(([k, v]) => [
          k,
          {
            type: v.type,
            required: !!v.required,
            description: v.description,
          },
        ]),
      ),
    }));
  }
  return data;
}

function buildExecutionSource(
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
const __invoke = __runline_invoke;
const __log = __runline_log;
try { delete globalThis.__runline_invoke; } catch {}
try { delete globalThis.__runline_log; } catch {}

const __fmt = (v) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

// Inlined MiniSearch UMD — attaches MiniSearch to globalThis inside the sandbox.
${__minisearchSource}

const __help = ${JSON.stringify(helpData)};

const __makeProxy = (path = []) => new Proxy(() => undefined, {
  get(_t, prop) {
    if (prop === 'then' || typeof prop === 'symbol') return undefined;
    return __makeProxy([...path, String(prop)]);
  },
  apply(_t, _this, args) {
    const p = path.join('.');
    if (!p) throw new Error('Action path missing');
    return Promise.resolve(__invoke(p, args[0]))
      .then((raw) => raw === undefined ? undefined : JSON.parse(raw));
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
    .map(([k, v]) => k + (v.required ? '' : '?') + ': ' + v.type)
    .join(', ');
  return plugin + '.' + entry.action + (fields ? '({ ' + fields + ' })' : '()');
};

// Build a MiniSearch index over every action path. Indexed at sandbox
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
        const expected = inputs[k].type;
        const actual = Array.isArray(provided[k]) ? 'array' : typeof provided[k];
        if (expected !== actual && !(provided[k] === null || provided[k] === undefined)) {
          typeErrors.push({ field: k, expected, actual });
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
})()`;

  return wrapped;
}
