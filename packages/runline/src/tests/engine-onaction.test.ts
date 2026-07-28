/**
 * The onAction hook — the engine's single observation point for
 * action invocations (added for vex's usage counters, SHFT-922).
 *
 * Contract under test:
 *   - fires once per invocation that ENTERS a plugin's execute(),
 *     success and failure alike, with the thrown value attached
 *   - does NOT fire for unknown paths or failed input validation —
 *     those throw before plugin code and are not invocations
 *   - a plugin that does `throw undefined` still reports as failed
 *   - a hook that throws never breaks the run
 *   - durationMs is a real elapsed measurement
 */

import { describe, expect, test } from "bun:test";
import * as t from "typebox";
import type { ActionInvocation } from "../index.js";
import { Runline } from "../index.js";
import type { PluginDef } from "../plugin/types.js";

const demo: PluginDef = {
  name: "demo",
  version: "0.0.0",
  actions: [
    {
      name: "ok",
      execute: async (input: unknown) => ({ echoed: input }),
    },
    {
      name: "slow",
      execute: async () => {
        await new Promise((res) => setTimeout(res, 25));
        return "done";
      },
    },
    {
      name: "boom",
      execute: async () => {
        throw new Error("upstream 500");
      },
    },
    {
      name: "boomUndefined",
      // biome-ignore lint/suspicious/useAwait: throws before it could await — a nullish throw is the case under test
      execute: async () => {
        throw undefined;
      },
    },
    {
      name: "typed",
      inputSchema: t.Object({ n: t.Number() }),
      execute: async () => "typed-ok",
    },
  ],
} as unknown as PluginDef;

function harness(onAction: (info: ActionInvocation) => void) {
  return Runline.create({
    plugins: [demo],
    connections: [{ name: "demo", plugin: "demo", config: {} }],
    timeoutMs: 4000,
    onAction,
  });
}

describe("onAction", () => {
  test("fires for success and failure with plugin, action, path", async () => {
    const seen: ActionInvocation[] = [];
    const rl = harness((i) => seen.push(i));

    const ok = await rl.execute("return await demo.ok({ n: 1 });");
    expect(ok.error).toBeUndefined();
    const bad = await rl.execute("return await demo.boom({});");
    expect(bad.error).toContain("upstream 500");
    rl.dispose();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      plugin: "demo",
      action: "ok",
      path: "demo.ok",
    });
    expect(seen[0]!.error).toBeUndefined();
    expect(seen[1]!.action).toBe("boom");
    expect(seen[1]!.error).toBeInstanceOf(Error);
    expect(String(seen[1]!.error)).toContain("upstream 500");
  });

  test("throw undefined still reports as a failure", async () => {
    const seen: ActionInvocation[] = [];
    const rl = harness((i) => seen.push(i));
    await rl.execute("return await demo.boomUndefined({});");
    rl.dispose();

    expect(seen).toHaveLength(1);
    expect("error" in seen[0]!).toBe(true);
    expect(seen[0]!.error).toBeInstanceOf(Error);
  });

  test("does not fire for unknown actions or failed validation", async () => {
    const seen: ActionInvocation[] = [];
    const rl = harness((i) => seen.push(i));

    const unknown = await rl.execute("return await demo.nope({});");
    expect(unknown.error).toContain("Unknown action");
    const invalid = await rl.execute(
      'return await demo.typed({ n: "not-a-number" });',
    );
    expect(invalid.error).toBeDefined();
    rl.dispose();

    expect(seen).toHaveLength(0);
  });

  test("a throwing hook never breaks the run", async () => {
    const rl = harness(() => {
      throw new Error("observer bug");
    });
    const out = await rl.execute("return await demo.ok({});");
    rl.dispose();

    expect(out.error).toBeUndefined();
    expect(out.result).toEqual({ echoed: {} });
  });

  test("fires per invocation, not per run", async () => {
    // The reason this hook lives at the dispatch point instead of
    // wrapping execute(): one body, several action calls, several
    // events — in call order.
    const seen: ActionInvocation[] = [];
    const rl = harness((i) => seen.push(i));
    const out = await rl.execute(
      "await demo.ok({ a: 1 }); await demo.slow({}); return await demo.ok({ b: 2 });",
    );
    rl.dispose();

    expect(out.error).toBeUndefined();
    expect(seen.map((i) => i.action)).toEqual(["ok", "slow", "ok"]);
  });

  test("durationMs measures the execute, not the worker round-trip setup", async () => {
    const seen: ActionInvocation[] = [];
    const rl = harness((i) => seen.push(i));
    await rl.execute("return await demo.slow({});");
    rl.dispose();

    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(20);
    expect(seen[0]!.durationMs).toBeLessThan(4000);
  });
});
