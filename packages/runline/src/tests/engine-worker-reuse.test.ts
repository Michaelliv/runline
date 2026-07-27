/**
 * Worker reuse — adversarial coverage.
 *
 * `ExecutionEngine` used to spawn one worker per `execute()`. That leaks
 * ~175KB of RSS per call under bun (~55KB under node) because a dead thread's
 * arena is never returned to the OS, and no amount of `terminate()`/listener
 * cleanup reclaims it. Five production deployments were being OOM-killed on a
 * 3–4h cycle as a result.
 *
 * The fix reuses one worker across many bodies. That trades a proven memory
 * bug for a set of isolation hazards, and this file exists to prove each
 * hazard is actually handled rather than assumed away. Everything here is a
 * question of the form "what could a body do that poisons the next one".
 */

import { describe, expect, test } from "bun:test";
import { Runline } from "../index.js";
import type { PluginDef } from "../plugin/types.js";

function engine(opts?: {
  plugins?: PluginDef[];
  timeoutMs?: number;
  memoryLimitBytes?: number;
  maxRunsPerWorker?: number;
}) {
  const plugins = opts?.plugins ?? [];
  return Runline.create({
    plugins,
    connections: plugins.map((p) => ({
      name: p.name,
      plugin: p.name,
      config: {},
    })),
    timeoutMs: opts?.timeoutMs ?? 4000,
    memoryLimitBytes: opts?.memoryLimitBytes ?? 128 * 1024 * 1024,
    ...(opts?.maxRunsPerWorker !== undefined
      ? { maxRunsPerWorker: opts.maxRunsPerWorker }
      : {}),
  } as never);
}

describe("worker reuse: it actually reuses", () => {
  test("consecutive runs land in the same worker", async () => {
    const rl = engine();
    // __runlineWorkerId is seeded once per worker before the baseline
    // snapshot, so it survives the per-run global scrub and is stable for
    // the worker's lifetime. process.threadId cannot be used here: the
    // runtime recycles thread ids, so a fresh worker can reuse one.
    const a = await rl.execute("return globalThis.__runlineWorkerId;");
    const b = await rl.execute("return globalThis.__runlineWorkerId;");
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.result).toBe(b.result);
    rl.dispose?.();
  });

  test("100 sequential runs all return correct results", async () => {
    const rl = engine({ maxRunsPerWorker: 1000 });
    for (let i = 0; i < 100; i++) {
      const r = await rl.execute(`return ${i} * 2;`);
      expect(r.error).toBeUndefined();
      expect(r.result).toBe(i * 2);
    }
    rl.dispose?.();
  }, 60_000);

  test("worker is retired after maxRunsPerWorker", async () => {
    const rl = engine({ maxRunsPerWorker: 3 });
    const ids: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await rl.execute("return globalThis.__runlineWorkerId;");
      ids.push(r.result);
    }
    // 7 runs at a cap of 3 must span more than one worker.
    expect(new Set(ids).size).toBeGreaterThan(1);
    rl.dispose?.();
  }, 60_000);
});

describe("worker reuse: state must not bleed", () => {
  test("globals set by one body are gone in the next", async () => {
    const rl = engine();
    await rl.execute("globalThis.LEAK = 'run1'; return 1;");
    const r = await rl.execute("return globalThis.LEAK ?? 'clean';");
    expect(r.result).toBe("clean");
    rl.dispose?.();
  });

  test("top-level const in one body does not collide with the next", async () => {
    const rl = engine();
    const a = await rl.execute("const x = 1; return x;");
    const b = await rl.execute("const x = 2; return x;");
    expect(a.result).toBe(1);
    expect(b.result).toBe(2);
    expect(b.error).toBeUndefined();
    rl.dispose?.();
  });

  test("var declarations do not leak to the next body", async () => {
    const rl = engine();
    await rl.execute("var sneaky = 'yes'; return 1;");
    const r = await rl.execute(
      "return typeof sneaky === 'undefined' ? 'clean' : sneaky;",
    );
    expect(r.result).toBe("clean");
    rl.dispose?.();
  });

  test("a body cannot see the previous body's pending invoke ids", async () => {
    const rl = engine();
    await rl.execute("return 1;");
    const r = await rl.execute("return typeof __pending;");
    // Internal names must not be reachable from user scope at all.
    expect(r.result).toBe("undefined");
    rl.dispose?.();
  });
});

describe("worker reuse: failures must not poison the pool", () => {
  test("a thrown error leaves the worker usable", async () => {
    const rl = engine();
    const bad = await rl.execute("throw new Error('boom');");
    expect(bad.error).toContain("boom");
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  });

  test("a rejected promise leaves the worker usable", async () => {
    const rl = engine();
    const bad = await rl.execute("await Promise.reject(new Error('nope'));");
    expect(bad.error).toContain("nope");
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  });

  test("a syntax error leaves the worker usable", async () => {
    const rl = engine();
    const bad = await rl.execute("this is not javascript ((((");
    expect(bad.error).toBeTruthy();
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  });

  test("a non-serializable result fails cleanly and the worker survives", async () => {
    const rl = engine();
    const bad = await rl.execute("const o = {}; o.self = o; return o;");
    expect(bad.error).toBeTruthy();
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  });

  test("an infinite loop times out and the NEXT run still works", async () => {
    const rl = engine({ timeoutMs: 700 });
    const spin = await rl.execute("while(true){}");
    expect(spin.error).toContain("timed out");
    // The wedged worker must have been retired, not reused.
    const good = await rl.execute("return 'recovered';");
    expect(good.error).toBeUndefined();
    expect(good.result).toBe("recovered");
    rl.dispose?.();
  }, 30_000);

  test("process.exit is still blocked and does not kill the pool", async () => {
    const rl = engine();
    const r = await rl.execute("process.exit(1); return 'no';");
    expect(r.error).toContain("process.exit");
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  });
});

describe("worker reuse: leftover timers", () => {
  test("a body that leaves setInterval running retires the worker", async () => {
    const rl = engine();
    await rl.execute("setInterval(() => {}, 5); return 'armed';");
    // If the dirty worker were reused, this run would share its event loop.
    const r = await rl.execute("return 'fresh';");
    expect(r.result).toBe("fresh");
    rl.dispose?.();
  }, 30_000);

  test("a leftover timer cannot mutate a later run", async () => {
    const rl = engine();
    await rl.execute(
      "setInterval(() => { globalThis.TICKS = (globalThis.TICKS||0)+1; }, 5); return 1;",
    );
    await new Promise((r) => setTimeout(r, 200));
    const r = await rl.execute("return globalThis.TICKS ?? 'none';");
    expect(r.result).toBe("none");
    rl.dispose?.();
  }, 30_000);

  test("a body that cleans up its own timer keeps the worker reusable", async () => {
    const rl = engine();
    await rl.execute(
      "const h = setInterval(() => {}, 5); clearInterval(h); return 'tidy';",
    );
    const a = await rl.execute("return globalThis.__runlineWorkerId;");
    const b = await rl.execute("return globalThis.__runlineWorkerId;");
    expect(a.result).toBe(b.result);
    rl.dispose?.();
  }, 30_000);

  test("an awaited setTimeout does not mark the worker dirty", async () => {
    const rl = engine();
    const r = await rl.execute(
      "await new Promise((r) => setTimeout(r, 20)); return 'done';",
    );
    expect(r.result).toBe("done");
    const a = await rl.execute("return globalThis.__runlineWorkerId;");
    const b = await rl.execute("return globalThis.__runlineWorkerId;");
    expect(a.result).toBe(b.result);
    rl.dispose?.();
  }, 30_000);
});

describe("worker reuse: concurrency and correlation", () => {
  test("overlapping runs do not cross-talk", async () => {
    const rl = engine();
    const [a, b, c] = await Promise.all([
      rl.execute("await new Promise(r=>setTimeout(r,80)); return 'A';"),
      rl.execute("await new Promise(r=>setTimeout(r,40)); return 'B';"),
      rl.execute("return 'C';"),
    ]);
    expect(a.result).toBe("A");
    expect(b.result).toBe("B");
    expect(c.result).toBe("C");
    rl.dispose?.();
  }, 30_000);

  test("logs are attributed to the run that emitted them", async () => {
    const rl = engine();
    const first = await rl.execute("console.log('first'); return 1;");
    const second = await rl.execute("console.log('second'); return 2;");
    expect(first.logs.join()).toContain("first");
    expect(first.logs.join()).not.toContain("second");
    expect(second.logs.join()).toContain("second");
    expect(second.logs.join()).not.toContain("first");
    rl.dispose?.();
  });

  test("a slow run's logs do not leak into a later run on the same worker", async () => {
    const rl = engine();
    await rl.execute(
      "console.log('early'); await new Promise(r=>setTimeout(r,30)); console.log('late'); return 1;",
    );
    const next = await rl.execute("return 2;");
    expect(next.logs).toEqual([]);
    rl.dispose?.();
  }, 30_000);
});

describe("worker reuse: plugin surface", () => {
  const pingPlugin = (reply: string): PluginDef =>
    ({
      name: "ping",
      actions: [
        {
          name: "say",
          description: "say something",
          inputSchema: {},
          execute: async () => reply,
        },
      ],
    }) as unknown as PluginDef;

  test("actions still work across reused runs", async () => {
    const rl = engine({ plugins: [pingPlugin("pong")] });
    const a = await rl.execute("return await ping.say();");
    const b = await rl.execute("return await ping.say();");
    expect(a.result).toBe("pong");
    expect(b.result).toBe("pong");
    rl.dispose?.();
  }, 30_000);

  test("actions.find still works on a reused worker", async () => {
    const rl = engine({ plugins: [pingPlugin("pong")] });
    await rl.execute("return 1;");
    const r = await rl.execute("return actions.list('ping');");
    expect(r.result).toEqual(["ping.say"]);
    rl.dispose?.();
  }, 30_000);

  test("an action error surfaces to the right run and worker survives", async () => {
    const boom: PluginDef = {
      name: "boom",
      actions: [
        {
          name: "go",
          description: "throws",
          inputSchema: {},
          execute: async () => {
            throw new Error("action failed");
          },
        },
      ],
    } as unknown as PluginDef;
    const rl = engine({ plugins: [boom] });
    const bad = await rl.execute("return await boom.go();");
    expect(bad.error).toContain("action failed");
    const good = await rl.execute("return 'alive';");
    expect(good.result).toBe("alive");
    rl.dispose?.();
  }, 30_000);
});

describe("worker reuse: the memory regression it exists to prevent", () => {
  test("300 executions retain far less than one-worker-per-run did", async () => {
    const rl = engine({ maxRunsPerWorker: 10_000 });
    for (let i = 0; i < 20; i++) await rl.execute("return 1;");
    Bun.gc(true);
    const start = process.memoryUsage().rss;
    let ok = 0;
    for (let i = 0; i < 300; i++) {
      const r = await rl.execute("return 1;");
      if (r.error === undefined && r.result === 1) ok++;
    }
    Bun.gc(true);
    const end = process.memoryUsage().rss;
    const perRun = (end - start) / 300;
    console.log(
      `    reuse: ${(perRun / 1024).toFixed(0)} KB/run (${(start / 1e6).toFixed(0)} -> ${(end / 1e6).toFixed(0)} MB) ok=${ok}`,
    );
    expect(ok).toBe(300); // never let this pass vacuously
    // Pre-fix measured 165–290 KB/run. 40KB is a wide margin that still fails
    // loudly if per-run worker spawning ever comes back.
    expect(perRun).toBeLessThan(40 * 1024);
    rl.dispose?.();
  }, 300_000);
});
