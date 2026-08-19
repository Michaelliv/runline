import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine, MAX_TIMEOUT_MS } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";

function createEngine(timeoutMs: number) {
  const registry = new PluginRegistry();
  const { api, resolve } = createPluginAPI("noop");
  api.setName("noop");
  api.setVersion("0.1.0");
  api.registerAction("ok", { execute: () => "ok" });
  registry.register(resolve());
  return new ExecutionEngine(registry, { ...DEFAULT_CONFIG, timeoutMs });
}

describe("timeout contract", () => {
  it("timeoutMs 0 disables the timer entirely, beating the engine default", async () => {
    // Engine default of 100ms would kill this 300ms body; an explicit
    // 0 means "no timeout" and must win over the default.
    const engine = createEngine(100);
    const result = await engine.execute(
      "await new Promise(r => setTimeout(r, 300)); return 'finished'",
      { timeoutMs: 0 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.result, "finished");
  });

  it("rejects a timeout past the int32 timer limit with a teaching error", async () => {
    // setTimeout stores its delay in an int32; past ~24.8 days it
    // overflows and fires at 0ms. Reject loudly — the caller can
    // self-correct to 0 (no timeout) — instead of killing the body
    // instantly with a timeout it never had.
    const engine = createEngine(5000);
    const result = await engine.execute("return 'unreachable'", {
      timeoutMs: MAX_TIMEOUT_MS + 1,
    });
    assert.ok(result.error);
    assert.match(result.error, /timeoutMs/);
    assert.match(result.error, /0 \(no timeout\)/);
  });

  it("rejects negative and non-finite timeouts", async () => {
    const engine = createEngine(5000);
    for (const timeoutMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await engine.execute("return 1", { timeoutMs });
      assert.ok(result.error, `expected rejection for ${timeoutMs}`);
      assert.match(result.error, /timeoutMs/);
    }
  });

  it("an omitted timeout still enforces the engine default", async () => {
    const engine = createEngine(100);
    const result = await engine.execute("await new Promise(() => {})");
    assert.ok(result.error);
    assert.match(result.error, /timed out after 100ms/);
  });
});
