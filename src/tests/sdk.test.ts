import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Runline } from "../sdk.js";
import type { RunlinePluginAPI } from "../plugin/api.js";

function mathPlugin(api: RunlinePluginAPI) {
  api.setName("math");
  api.setVersion("1.0.0");
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
}

function echoPlugin(api: RunlinePluginAPI) {
  api.setName("echo");
  api.setVersion("1.0.0");
  api.registerAction("say", {
    description: "Echo back",
    execute(input) {
      return input;
    },
  });
}

describe("Runline SDK", () => {
  it("creates an instance and executes code", async () => {
    const rl = Runline.create({ plugins: [mathPlugin] });
    const result = await rl.execute("return await math.add({ a: 5, b: 3 })");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { sum: 8 });
  });

  it("works with no plugins", async () => {
    const rl = Runline.create();
    const result = await rl.execute("return 42");
    assert.equal(result.error, undefined);
    assert.equal(result.result, 42);
  });

  it("supports multiple plugins", async () => {
    const rl = Runline.create({ plugins: [mathPlugin, echoPlugin] });
    const result = await rl.execute(`
      const sum = await math.add({ a: 1, b: 2 });
      const echoed = await echo.say({ msg: sum.sum });
      return echoed;
    `);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { msg: 3 });
  });

  it("lists actions", () => {
    const rl = Runline.create({ plugins: [mathPlugin, echoPlugin] });
    const actions = rl.actions();
    assert.equal(actions.length, 2);
    assert.ok(actions.some((a) => a.plugin === "math" && a.action === "add"));
    assert.ok(actions.some((a) => a.plugin === "echo" && a.action === "say"));
  });

  it("lists plugins", () => {
    const rl = Runline.create({ plugins: [mathPlugin] });
    const plugins = rl.plugins();
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, "math");
    assert.equal(plugins[0].version, "1.0.0");
    assert.deepEqual(plugins[0].actions, ["add"]);
  });

  it("adds a plugin after creation", async () => {
    const rl = Runline.create({ plugins: [mathPlugin] });
    rl.addPlugin(echoPlugin);
    const result = await rl.execute('return await echo.say({ x: "late" })');
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { x: "late" });
  });

  it("accepts PluginDef objects directly", async () => {
    const def = {
      name: "inline",
      version: "0.1.0",
      actions: [
        {
          name: "greet",
          description: "Say hello",
          execute: (input: unknown) => {
            const { name } = input as { name: string };
            return `hello ${name}`;
          },
        },
      ],
    };
    const rl = Runline.create({ plugins: [def] });
    const result = await rl.execute(
      'return await inline.greet({ name: "world" })',
    );
    assert.equal(result.error, undefined);
    assert.equal(result.result, "hello world");
  });
});
