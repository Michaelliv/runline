/**
 * Per-execute context: an opaque value the embedder attaches to one
 * `execute()` call, delivered to every action's `ctx.context` for
 * exactly that run.
 *
 * Why it exists: an embedder may keep one long-lived engine serving
 * many callers (a warm surface). Anything baked into the connection
 * config is then shared by all of them — so call-scoped facts, like
 * the identity a shared surface is currently acting for, need a
 * channel that travels with the call. This is that channel.
 *
 * Trust properties pinned here:
 *   - host-supplied: only `execute()` options set it; worker code
 *     cannot read or forge it (invoke messages carry path + args)
 *   - run-correlated: concurrent bodies on one engine each observe
 *     exactly their own context, never a neighbour's
 *   - optional: a call without a context delivers `undefined`,
 *     byte-for-byte the pre-context behavior
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";

function makeProbePlugin() {
  const { api, resolve } = createPluginAPI("probe");
  api.setName("probe");
  api.setVersion("0.1.0");

  api.registerAction("whoami", {
    description: "Returns the per-run context this call carried",
    execute(_input, ctx) {
      return { context: ctx.context ?? null };
    },
  });

  api.registerAction("slowWhoami", {
    description: "Same, after yielding — outlives an overlapping run",
    async execute(_input, ctx) {
      await new Promise((r) => setTimeout(r, 30));
      return { context: ctx.context ?? null };
    },
  });

  return resolve();
}

function createEngine() {
  const registry = new PluginRegistry();
  registry.register(makeProbePlugin());
  return new ExecutionEngine(registry, {
    ...DEFAULT_CONFIG,
    timeoutMs: 5000,
  });
}

describe("per-execute context", () => {
  it("delivers the context to the action's ctx for that run", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "return await probe.whoami({})",
      { context: { identity: { userId: "u1", sessionId: "s1" } } },
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, {
      context: { identity: { userId: "u1", sessionId: "s1" } },
    });
  });

  it("delivers undefined when no context was passed — backwards compatible", async () => {
    const engine = createEngine();
    const result = await engine.execute("return await probe.whoami({})");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { context: null });
  });

  it("never crosses contexts between concurrent runs on one engine", async () => {
    // One run lands on the pooled worker, the overlapping ones get
    // private workers; each invoke is correlated to its run by runId,
    // so each body must observe exactly its own caller.
    const engine = createEngine();
    const runs = await Promise.all(
      ["a", "b", "c"].map((id) =>
        engine.execute("return await probe.slowWhoami({})", {
          context: { caller: id },
        }),
      ),
    );
    assert.deepEqual(
      runs.map((r) => r.error),
      [undefined, undefined, undefined],
    );
    assert.deepEqual(
      runs.map((r) => (r.result as { context: unknown }).context),
      [{ caller: "a" }, { caller: "b" }, { caller: "c" }],
    );
  });

  it("scopes the context to its run on a reused pooled worker", async () => {
    // Sequential runs share the pooled worker. The second run must not
    // inherit the first run's context, and dropping the option must
    // drop the value — nothing lingers on the worker or the engine.
    const engine = createEngine();
    const first = await engine.execute("return await probe.whoami({})", {
      context: { caller: "first" },
    });
    assert.deepEqual(first.result, { context: { caller: "first" } });

    const second = await engine.execute("return await probe.whoami({})", {
      context: { caller: "second" },
    });
    assert.deepEqual(second.result, { context: { caller: "second" } });

    const third = await engine.execute("return await probe.whoami({})");
    assert.deepEqual(third.result, { context: null });
  });

  it("stays invisible to worker code — only actions receive it", async () => {
    // The context must not leak into the body's scope or globals:
    // it is the host's channel to plugin code, not the agent's.
    const engine = createEngine();
    const result = await engine.execute(
      `return {
        inScope: typeof context !== "undefined",
        onGlobal: "context" in globalThis || "__context" in globalThis,
      }`,
      { context: { secret: "host-only" } },
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { inScope: false, onGlobal: false });
  });
});
