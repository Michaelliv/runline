import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Literal,
  Array as TArray,
  Boolean as TBoolean,
  Number as TNumber,
  Object as TObject,
  String as TString,
  Union,
} from "typebox";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";

function makeTestPlugin() {
  const { api, resolve } = createPluginAPI("test");
  api.setName("math");
  api.setVersion("0.1.0");

  api.registerAction("add", {
    description: "Add two numbers",
    inputSchema: {
      a: { type: "number", required: true },
      b: { type: "number", required: true },
    },
    execute(input) {
      const { a, b } = input as { a: number; b: number };
      return { sum: a + b };
    },
  });

  api.registerAction("echo", {
    description: "Echo input back",
    execute(input) {
      return input;
    },
  });

  api.registerAction("typed", {
    description: "Action with a TypeBox input schema",
    inputSchema: TObject(
      {
        mode: Union([Literal("safe"), Literal("loud")]),
        enabled: TBoolean(),
        label: TString({ minLength: 2, maxLength: 5 }),
        amount: TNumber({ minimum: 1, maximum: 10 }),
        tags: TArray(TString()),
        nested: TObject(
          {
            count: TNumber(),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    execute(input) {
      return input;
    },
  });

  api.registerAction("legacyTypeField", {
    description: "Legacy schema with a field named type",
    inputSchema: {
      type: { type: "string", required: true },
    },
    execute(input) {
      return input;
    },
  });

  api.registerAction("fail", {
    description: "Always throws",
    execute() {
      throw new Error("intentional failure");
    },
  });

  api.registerAction("slow", {
    description: "Async action",
    async execute(input) {
      const { ms } = input as { ms: number };
      await new Promise((r) => setTimeout(r, ms));
      return { waited: ms };
    },
  });

  return resolve();
}

function createEngine() {
  const registry = new PluginRegistry();
  registry.register(makeTestPlugin());
  return new ExecutionEngine(registry, {
    ...DEFAULT_CONFIG,
    timeoutMs: 5000,
  });
}

describe("ExecutionEngine", () => {
  it("executes plain JS and returns a value", async () => {
    const engine = createEngine();
    const result = await engine.execute("return 1 + 2");
    assert.equal(result.error, undefined);
    assert.equal(result.result, 3);
  });

  it("calls a plugin action through the actions proxy", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "return await actions.math.add({ a: 10, b: 20 })",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { sum: 30 });
  });

  it("calls a plugin action as a top-level global", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "return await math.add({ a: 3, b: 4 })",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { sum: 7 });
  });

  it("calls echo action", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      'return await actions.math.echo({ hello: "world" })',
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { hello: "world" });
  });

  it("captures console.log as logs", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      'console.log("hello"); console.warn("warning"); return 42',
    );
    assert.equal(result.error, undefined);
    assert.equal(result.result, 42);
    assert.ok(result.logs.some((l) => l.includes("hello")));
    assert.ok(result.logs.some((l) => l.includes("warning")));
  });

  it("reports action errors", async () => {
    const engine = createEngine();
    const result = await engine.execute("return await actions.math.fail()");
    assert.ok(result.error);
    assert.ok(result.error.includes("intentional failure"));
  });

  it("reports unknown action errors", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "return await actions.math.nonexistent()",
    );
    assert.ok(result.error);
    assert.ok(result.error.includes("Unknown action"));
  });

  it("handles async actions", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "return await actions.math.slow({ ms: 10 })",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { waited: 10 });
  });

  it("validates TypeBox input schemas before executing", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      `return await math.typed({ mode: "safe", enabled: true, label: "abc", amount: 5, tags: ["ok"], nested: { count: 2 } })`,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, {
      mode: "safe",
      enabled: true,
      label: "abc",
      amount: 5,
      tags: ["ok"],
      nested: { count: 2 },
    });
  });

  it("rejects invalid TypeBox inputs before executing", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      `return await math.typed({ mode: "danger", enabled: "yes", label: "abcdef", amount: 11, extra: true, nested: { nope: 1 } })`,
    );
    assert.ok(result.error);
    assert.match(result.error, /Invalid input for math\.typed/);
    assert.match(result.error, /Validation errors:/);
    assert.match(result.error, /must not have additional properties/);
    assert.match(result.error, /\/mode must match a schema in anyOf/);
    assert.match(result.error, /\/enabled must be boolean/);
    assert.match(result.error, /\/label must not have more than 5 characters/);
    assert.match(result.error, /\/amount must be <= 10/);
  });

  it("does not confuse a legacy field named type for a TypeBox schema", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      `return await math.legacyTypeField({ type: 123, extra: true })`,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { type: 123, extra: true });
  });

  it("keeps legacy input schemas metadata-only at execution time", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      `return await math.add({ a: "loose", b: 2, extra: true })`,
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { sum: "loose2" });
  });

  it("executes plain JS with variables", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "const x = 5; const y = 'hello'; return { x, y }",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { x: 5, y: "hello" });
  });

  it("handles arrow function syntax", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      "async () => { return await actions.math.add({ a: 3, b: 7 }) }",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { sum: 10 });
  });

  it("blocks fetch", async () => {
    const engine = createEngine();
    const result = await engine.execute(
      'try { await fetch("http://example.com"); return "should not reach"; } catch(e) { return e.message }',
    );
    assert.equal(result.error, undefined);
    assert.ok((result.result as string).includes("disabled"));
  });

  it("times out long-running code", async () => {
    const registry = new PluginRegistry();
    registry.register(makeTestPlugin());
    const engine = new ExecutionEngine(registry, {
      ...DEFAULT_CONFIG,
      timeoutMs: 200,
    });
    const result = await engine.execute("while(true) {}");
    assert.ok(result.error);
    assert.ok(
      result.error.includes("timed out") ||
        result.error.includes("interrupted"),
    );
  });
});
