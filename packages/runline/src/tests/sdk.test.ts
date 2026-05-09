import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunlinePluginAPI } from "../plugin/api.js";
import { Runline } from "../sdk.js";

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

function fakeNodePlugin(api: RunlinePluginAPI) {
  api.setName("node");
  api.setVersion("9.9.9");
  api.registerAction("os.platform", {
    execute() {
      return "fake";
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
    assert.ok(actions.some((a) => a.plugin === "math" && a.action === "add"));
    assert.ok(actions.some((a) => a.plugin === "echo" && a.action === "say"));
    assert.ok(
      actions.some((a) => a.plugin === "node" && a.action === "fs.readFile"),
    );
  });

  it("lists plugins", () => {
    const rl = Runline.create({ plugins: [mathPlugin] });
    const plugins = rl.plugins();
    const math = plugins.find((p) => p.name === "math");
    const node = plugins.find((p) => p.name === "node");
    assert.ok(math);
    assert.equal(math.version, "1.0.0");
    assert.deepEqual(math.actions, ["add"]);
    assert.ok(node);
    assert.ok(node.actions.includes("fs.readFile"));
  });

  it("adds a plugin after creation", async () => {
    const rl = Runline.create({ plugins: [mathPlugin] });
    rl.addPlugin(echoPlugin);
    const result = await rl.execute('return await echo.say({ x: "late" })');
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { x: "late" });
  });

  it("keeps native node reserved even if a plugin tries to replace it", async () => {
    const rl = Runline.create({ plugins: [fakeNodePlugin] });
    const result = await rl.execute("return await node.os.platform()");
    assert.equal(result.error, undefined);
    assert.notEqual(result.result, "fake");
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
