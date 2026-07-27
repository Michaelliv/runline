/**
 * Worker reuse — pool lifecycle and the invariants that make reuse legal.
 *
 * Companion to engine-worker-reuse.test.ts, which covers what a *body* can do
 * to poison the next one. This file covers what the *host* can get wrong:
 * handing back a worker whose baked-in configuration does not match what the
 * caller asked for, or failing to retire one that is no longer trustworthy.
 *
 * Two tests here are regressions for bugs found by re-reading the diff:
 * `workerShape` originally keyed on `JSON.stringify(helpData).length` (a
 * length, so collidable), and per-call `memoryLimitBytes` was ignored entirely
 * on a reused worker because `resourceLimits` is fixed at construction.
 */

import { describe, expect, test } from "bun:test";
import { buildRunBody } from "../core/engine.js";
import { Runline } from "../index.js";
import type { PluginDef } from "../plugin/types.js";

const WORKER_ID = "return globalThis.__runlineWorkerId;";

function plugin(name: string, actionName = "go", reply = "ok"): PluginDef {
  return {
    name,
    actions: [
      {
        name: actionName,
        description: `${name} ${actionName}`,
        inputSchema: {},
        execute: async () => reply,
      },
    ],
  } as unknown as PluginDef;
}

function engine(
  opts: {
    plugins?: PluginDef[];
    timeoutMs?: number;
    memoryLimitBytes?: number;
    maxRunsPerWorker?: number;
  } = {},
) {
  const plugins = opts.plugins ?? [];
  return Runline.create({
    plugins,
    connections: plugins.map((p) => ({
      name: p.name,
      plugin: p.name,
      config: {},
    })),
    timeoutMs: opts.timeoutMs ?? 4000,
    memoryLimitBytes: opts.memoryLimitBytes ?? 128 * 1024 * 1024,
    ...(opts.maxRunsPerWorker !== undefined
      ? { maxRunsPerWorker: opts.maxRunsPerWorker }
      : {}),
  });
}

describe("worker shape: a run never inherits the wrong worker", () => {
  test("REGRESSION: a different per-call memory limit forces a fresh worker", async () => {
    // resourceLimits are fixed when the Worker is constructed. Reusing a
    // worker built for 64MB to serve a run that asked for 256MB would apply
    // the wrong ceiling silently.
    const rl = engine({ memoryLimitBytes: 64 * 1024 * 1024 });
    const a = await rl.execute(WORKER_ID);
    const b = await rl.execute(WORKER_ID, {
      memoryLimitBytes: 256 * 1024 * 1024,
    });
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.result).not.toBe(b.result);
    rl.dispose();
  }, 30_000);

  test("the same per-call memory limit still reuses", async () => {
    const rl = engine({ memoryLimitBytes: 64 * 1024 * 1024 });
    const a = await rl.execute(WORKER_ID, {
      memoryLimitBytes: 128 * 1024 * 1024,
    });
    const b = await rl.execute(WORKER_ID, {
      memoryLimitBytes: 128 * 1024 * 1024,
    });
    expect(a.result).toBe(b.result);
    rl.dispose();
  }, 30_000);

  test("REGRESSION: plugin surfaces of equal serialized length are distinguished", async () => {
    // The original shape key was `JSON.stringify(helpData).length`. These two
    // surfaces serialize to the same length, so a length-based key collides
    // and the second Runline would be handed a worker exposing `aaa.go`.
    const one = engine({ plugins: [plugin("aaa")] });
    const two = engine({ plugins: [plugin("bbb")] });
    const a = await one.execute("return actions.list();");
    const b = await two.execute("return actions.list();");
    expect(a.result).toEqual(["aaa.go"]);
    expect(b.result).toEqual(["bbb.go"]);
    one.dispose();
    two.dispose();
  }, 30_000);

  test("addPlugin retires the pooled worker so new actions are visible", async () => {
    const rl = engine({ plugins: [plugin("first")] });
    const before = await rl.execute("return actions.list();");
    expect(before.result).toEqual(["first.go"]);

    rl.addPlugin(plugin("second"), [
      { name: "second", plugin: "second", config: {} },
    ]);

    const after = await rl.execute("return actions.list().sort();");
    expect(after.result).toEqual(["first.go", "second.go"]);
    rl.dispose();
  }, 30_000);
});

describe("pool lifecycle", () => {
  test("retires after exactly maxRunsPerWorker bodies", async () => {
    const rl = engine({ maxRunsPerWorker: 3 });
    const ids: unknown[] = [];
    for (let i = 0; i < 6; i++) ids.push((await rl.execute(WORKER_ID)).result);
    // Runs 1-3 share a worker, 4-6 share the next one.
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[2]);
    expect(ids[3]).toBe(ids[4]);
    expect(ids[4]).toBe(ids[5]);
    rl.dispose();
  }, 60_000);

  test("dispose is idempotent and the engine still works after it", async () => {
    const rl = engine();
    const before = await rl.execute(WORKER_ID);
    rl.dispose();
    rl.dispose();
    rl.dispose();
    const after = await rl.execute(WORKER_ID);
    expect(after.error).toBeUndefined();
    expect(after.result).not.toBe(before.result);
    rl.dispose();
  }, 30_000);

  test("a timed-out worker is retired, not returned to the pool", async () => {
    const rl = engine({ timeoutMs: 500 });
    const first = await rl.execute(WORKER_ID);
    const spin = await rl.execute("while(true){}");
    expect(spin.error).toContain("timed out");
    const after = await rl.execute(WORKER_ID);
    expect(after.result).not.toBe(first.result);
    rl.dispose();
  }, 30_000);

  test("a clean run keeps the very same worker", async () => {
    const rl = engine();
    const a = await rl.execute("return 1;");
    const idA = await rl.execute(WORKER_ID);
    const idB = await rl.execute(WORKER_ID);
    expect(a.result).toBe(1);
    expect(idA.result).toBe(idB.result);
    rl.dispose();
  }, 30_000);

  test("overlapping runs use separate workers and the pooled one survives", async () => {
    const rl = engine();
    const pooledId = (await rl.execute(WORKER_ID)).result;
    const [slow, fast] = await Promise.all([
      rl.execute(`await new Promise(r=>setTimeout(r,120)); ${WORKER_ID}`),
      rl.execute(`await new Promise(r=>setTimeout(r,10)); ${WORKER_ID}`),
    ]);
    // One of them reused the pooled worker; the other got a private one.
    expect(slow.result).not.toBe(fast.result);
    expect([slow.result, fast.result]).toContain(pooledId);
    // The pooled worker is still the pooled worker afterwards.
    const next = await rl.execute(WORKER_ID);
    expect(next.result).toBe(pooledId);
    rl.dispose();
  }, 30_000);
});

describe("contamination a scrub cannot remove retires the worker", () => {
  // Policy: anything a body leaves behind that the next body could observe
  // makes the worker untrustworthy. Removable state is removed; unremovable
  // state retires the worker. Neither is allowed to reach the next run.

  test("mutating a shared intrinsic does not reach the next run", async () => {
    const rl = engine();
    await rl.execute("Array.prototype.__poisoned = 'yes'; return 1;");
    const r = await rl.execute("return [].__poisoned ?? 'clean';");
    expect(r.result).toBe("clean");
    rl.dispose();
  }, 30_000);

  test("a body that mutates an intrinsic gets its worker retired", async () => {
    const rl = engine();
    const before = await rl.execute(WORKER_ID);
    await rl.execute("Object.prototype.__evil = 1; return 1;");
    const after = await rl.execute(WORKER_ID);
    expect(after.result).not.toBe(before.result);
    rl.dispose();
  }, 30_000);

  test("a non-configurable global does not reach the next run", async () => {
    const rl = engine();
    const first = await rl.execute(
      "Object.defineProperty(globalThis,'STUCK',{value:1,configurable:false}); return 'set';",
    );
    expect(first.result).toBe("set");
    const second = await rl.execute(
      "return typeof globalThis.STUCK === 'undefined' ? 'clean' : 'leaked';",
    );
    expect(second.result).toBe("clean");
    rl.dispose();
  }, 30_000);

  test("an undeletable global retires the worker rather than wedging it", async () => {
    const rl = engine();
    const before = await rl.execute(WORKER_ID);
    await rl.execute(
      "Object.defineProperty(globalThis,'STUCK2',{value:1,configurable:false}); return 1;",
    );
    const after = await rl.execute(WORKER_ID);
    expect(after.error).toBeUndefined();
    expect(after.result).not.toBe(before.result);
    rl.dispose();
  }, 30_000);

  test("REPLACING an existing intrinsic method retires the worker", async () => {
    // The name-only fingerprint this replaced could not see this: overwriting
    // push adds no new property name. It is also the likeliest real-world
    // monkey-patch, so it must not reach the next body.
    const rl = engine();
    const before = await rl.execute(WORKER_ID);
    await rl.execute(
      "Array.prototype.push = function(){ return 'pwned'; }; return 1;",
    );
    const after = await rl.execute(
      "const a = []; return [a.push(1), globalThis.__runlineWorkerId];",
    );
    const [pushResult, workerId] = after.result as [unknown, string];
    expect(pushResult).toBe(1); // real push, not the replacement
    expect(workerId).not.toBe(before.result);
    rl.dispose();
  }, 30_000);

  test("deleting an intrinsic method retires the worker", async () => {
    const rl = engine();
    const before = await rl.execute(WORKER_ID);
    await rl.execute("delete Array.prototype.map; return 1;");
    const after = await rl.execute(
      "return [typeof [].map, globalThis.__runlineWorkerId];",
    );
    const [mapType, workerId] = after.result as [string, string];
    expect(mapType).toBe("function");
    expect(workerId).not.toBe(before.result);
    rl.dispose();
  }, 30_000);

  test("an ordinary body does NOT trip the contamination check", async () => {
    // The fingerprint must not be so twitchy that normal work retires the
    // worker — that would quietly restore the per-run-worker leak.
    const rl = engine();
    const a = await rl.execute(
      "const m = new Map([[1,2]]); const s = new Set([1]); const d = new Date(); return [m.get(1), s.has(1), typeof d.toISOString()];",
    );
    expect(a.result).toEqual([2, true, "string"]);
    const idA = await rl.execute(WORKER_ID);
    const idB = await rl.execute(
      "JSON.parse(JSON.stringify({a:1})); Math.max(1,2); return globalThis.__runlineWorkerId;",
    );
    expect(idA.result).toBe(idB.result);
    rl.dispose();
  }, 30_000);
});

describe("a hostile body cannot corrupt a later run", () => {
  // The worker is documented as an ergonomic surface, not a security
  // sandbox: a body can reach `require("node:worker_threads").parentPort`.
  // Pooling means a forged message could now target a *later* run rather than
  // only the body's own, so run ids are unguessable tokens.
  test("a body cannot read its own run id", async () => {
    const rl = engine();
    // `new Function` compiles in the worker's global scope, so module-scope
    // bindings like __runId are not reachable.
    const r = await rl.execute("return typeof __runId;");
    expect(r.result).toBe("undefined");
    rl.dispose();
  }, 30_000);

  test("a body cannot post to the host channel at all", async () => {
    // Two layers, and this asserts the outer one. Even if a body knew a
    // runId, it has no channel to send on: the require chokepoint blanks
    // parentPort. Run-id randomisation remains as the inner layer for any
    // route not yet closed.
    const rl = engine();
    const forge = `
      const { parentPort } = require("node:worker_threads");
      for (let i = 0; i < 12; i++) {
        parentPort.postMessage({ t: "done", runId: String(i), ok: true, result: "HIJACKED" });
      }
      return "forged";
    `;
    const first = await rl.execute(forge);
    expect(first.result).not.toBe("forged");
    expect(first.error).toBeTruthy();

    const second = await rl.execute("return 'honest';");
    expect(second.result).toBe("honest");
    const third = await rl.execute("return 7 * 6;");
    expect(third.result).toBe(42);
    rl.dispose();
  }, 30_000);

  test("REGRESSION: a body cannot install a listener that hijacks later runs", async () => {
    // The real attack, and the reason run-id randomisation was not enough:
    // a listener on parentPort survives into later runs and is *told* each
    // new runId by the host's own "run" message, so it can forge a "done"
    // for a run it could never have guessed. Verified to fully hijack every
    // subsequent run before the require chokepoint was added.
    const rl = engine();
    const install = await rl.execute(`
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", (m) => {
        if (m && m.t === "run") {
          parentPort.postMessage({ t: "done", runId: m.runId, ok: true, result: "HIJACKED" });
        }
      });
      return "installed";
    `);
    expect(install.result).not.toBe("installed");

    const victim = await rl.execute("return 'honest-value';");
    expect(victim.result).toBe("honest-value");
    const victim2 = await rl.execute("return 6 * 7;");
    expect(victim2.result).toBe(42);
    rl.dispose();
  }, 30_000);

  test("parentPort is unreachable under both module ids", async () => {
    const rl = engine();
    const r = await rl.execute(`
      const a = require("node:worker_threads");
      const b = require("worker_threads");
      return [a.parentPort, b.parentPort, typeof a.Worker];
    `);
    expect(r.result).toEqual([null, null, "function"]);
    rl.dispose();
  }, 30_000);

  test("the blanked module cannot be patched back", async () => {
    const rl = engine();
    const r = await rl.execute(`
      const m = require("node:worker_threads");
      try { m.parentPort = 'restored'; } catch (e) { /* frozen */ }
      return m.parentPort;
    `);
    expect(r.result).toBe(null);
    rl.dispose();
  }, 30_000);

  test("a forged log line is not attributed to a later run", async () => {
    const rl = engine();
    await rl.execute(`
      const { parentPort } = require("node:worker_threads");
      for (let i = 0; i < 12; i++) {
        parentPort.postMessage({ t: "log", runId: String(i), level: "log", line: "INJECTED" });
      }
      return 1;
    `);
    const next = await rl.execute("return 2;");
    expect(next.logs.join()).not.toContain("INJECTED");
    rl.dispose();
  }, 30_000);
});

describe("the host runtime a body is promised", () => {
  // Pooling compiles bodies with `new Function`, whose scope is the worker's
  // global object rather than the module scope the body used to be inlined
  // into. Globals survive that move; module-scope bindings do not. `require`
  // is the one that matters and is injected explicitly — without this test a
  // memory fix silently revokes a documented capability.
  test("require is available and functional", async () => {
    const rl = engine();
    const r = await rl.execute(
      "const c = require('node:crypto'); return typeof c.randomUUID;",
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toBe("function");
    rl.dispose();
  }, 30_000);

  test("require still works on a reused worker", async () => {
    const rl = engine();
    await rl.execute("return 1;");
    const r = await rl.execute("return typeof require('node:path').join;");
    expect(r.result).toBe("function");
    rl.dispose();
  }, 30_000);

  test("Buffer and process remain reachable", async () => {
    const rl = engine();
    const r = await rl.execute(
      "return [typeof Buffer, typeof process, Buffer.from('hi').toString('base64')];",
    );
    expect(r.result).toEqual(["function", "object", "aGk="]);
    rl.dispose();
  }, 30_000);

  test("fetch is still disabled", async () => {
    const rl = engine();
    const r = await rl.execute("return await fetch('https://example.com');");
    expect(r.error).toContain("fetch is disabled");
    rl.dispose();
  }, 30_000);
});

describe("buildRunBody: the calling convention", () => {
  test("a bare statement body is passed through unchanged", () => {
    expect(buildRunBody("return 1;")).toBe("return 1;");
  });

  test("an arrow function body is invoked", () => {
    const out = buildRunBody("async () => 42");
    expect(out).toContain("const __fn = (async () => 42)");
    expect(out).toContain("return await __fn();");
  });

  test("a non-function arrow-looking body throws at run time", async () => {
    const rl = engine();
    const r = await rl.execute("(1) => 2, 'not a function'");
    expect(r.error).toBeTruthy();
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose();
  }, 30_000);
});
