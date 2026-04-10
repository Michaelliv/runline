import {
  getQuickJS,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from "quickjs-emscripten";
import { applyEnvOverrides } from "../config/loader.js";
import type { RunlineConfig } from "../config/types.js";
import type {
  ActionContext,
  ConnectionConfig,
  PluginDef,
} from "../plugin/types.js";
import type { PluginRegistry } from "../plugin/registry.js";

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
                const msg =
                  err instanceof Error ? err.message : String(err);
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

        // Build execution source, then strip TS types from the wrapped result
        const source = await buildExecutionSource(code);

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

          const settled =
            readProp(context, stateHandle, "settled") === true;
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

  private async invokeAction(
    path: string,
    args: unknown,
  ): Promise<unknown> {
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
    };

    return action.execute(args, ctx);
  }

  private resolveConnection(plugin: PluginDef): ConnectionConfig {
    const conn = this.config.connections.find(
      (c) => c.plugin === plugin.name,
    );
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
          Promise.race(
            [...pendingDeferreds].map((d) => d.settled),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Execution timed out after ${timeoutMs}ms`),
                ),
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

async function stripTypes(source: string): Promise<string> {
  const { transform } = await import("esbuild");
  const result = await transform(source, {
    loader: "ts",
    target: "es2022",
  });
  return result.code;
}

async function buildExecutionSource(code: string): Promise<string> {
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
const actions = __makeProxy();

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

  return stripTypes(wrapped);
}
