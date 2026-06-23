import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverPlugins, loadPluginFromPath } from "../plugin/loader.js";

describe("loadPluginFromPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `runline-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  it("loads a plugin from a single .js file", async () => {
    const pluginFile = join(tempDir, "myPlugin.js");
    writeFileSync(
      pluginFile,
      `export default function myPlugin(api) {
        api.setName("myPlugin");
        api.setVersion("1.0.0");
        api.registerAction("ping", {
          description: "Ping",
          execute: () => "pong",
        });
      }`,
    );
    const plugin = await loadPluginFromPath(pluginFile);
    assert.equal(plugin.name, "myPlugin");
    assert.equal(plugin.actions.length, 1);
    assert.equal(plugin.actions[0].name, "ping");
  });

  it("loads a plugin from a directory with src/index.js", async () => {
    const pluginDir = join(tempDir, "testPlugin");
    mkdirSync(join(pluginDir, "src"), { recursive: true });
    writeFileSync(
      join(pluginDir, "src", "index.js"),
      `export default function testPlugin(api) {
        api.setName("testPlugin");
        api.registerAction("hello", {
          execute: () => "world",
        });
      }`,
    );
    const plugin = await loadPluginFromPath(pluginDir);
    assert.equal(plugin.name, "testPlugin");
    assert.equal(plugin.actions.length, 1);
  });

  it("loads a plugin from a directory with index.js", async () => {
    const pluginDir = join(tempDir, "flat");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "index.js"),
      `export default function flat(api) {
        api.setName("flat");
        api.registerAction("run", { execute: () => null });
      }`,
    );
    const plugin = await loadPluginFromPath(pluginDir);
    assert.equal(plugin.name, "flat");
  });

  it("prefers package.json main over convention", async () => {
    const pluginDir = join(tempDir, "custom");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "package.json"),
      JSON.stringify({ main: "entry.js" }),
    );
    writeFileSync(
      join(pluginDir, "entry.js"),
      `export default function custom(api) {
        api.setName("custom");
        api.registerAction("x", { execute: () => "from-main" });
      }`,
    );
    writeFileSync(
      join(pluginDir, "index.js"),
      `export default function custom(api) {
        api.setName("wrong");
        api.registerAction("x", { execute: () => "from-index" });
      }`,
    );
    const plugin = await loadPluginFromPath(pluginDir);
    assert.equal(plugin.name, "custom");
  });

  it("throws for directory with no entry point", async () => {
    const emptyDir = join(tempDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    await assert.rejects(
      () => loadPluginFromPath(emptyDir),
      /No entry point found/,
    );
  });

  it("loads external plugins that import runline", async () => {
    const pluginFile = join(tempDir, "external.ts");
    writeFileSync(
      pluginFile,
      `import type { RunlinePluginAPI } from "runline";
import { commandExists } from "runline";

export default function external(api: RunlinePluginAPI) {
  void commandExists;
  api.setName("external");
  api.registerAction("ping", {
    description: "Ping",
    execute: () => "pong",
  });
}
`,
    );

    const plugin = await loadPluginFromPath(pluginFile);
    assert.equal(plugin.name, "external");
    assert.equal(plugin.actions[0].name, "ping");
  });

  it("loads external plugins that import runline public subpaths", async () => {
    const pluginFile = join(tempDir, "subpaths.ts");
    writeFileSync(
      pluginFile,
      `import type { RunlinePluginAPI } from "runline";
import { syncExec } from "runline/utils/cli";

export default function subpaths(api: RunlinePluginAPI) {
  void syncExec;
  api.setName("subpaths");
  api.registerAction("ping", {
    description: "Ping",
    execute: () => "pong",
  });
}
`,
    );

    const plugin = await loadPluginFromPath(pluginFile);
    assert.equal(plugin.name, "subpaths");
    assert.equal(plugin.actions[0].name, "ping");
  });

  it("ignores private helper directories during discovery", async () => {
    const builtinDir = join(tempDir, "builtins");
    const pluginDir = join(builtinDir, "alpha");
    const helperDir = join(builtinDir, "_shared");
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "index.js"),
      `export default function alpha(api) {
        api.setName("alpha");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(join(helperDir, "util.js"), "export const value = 1;");

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const plugins = await discoverPlugins(null, { builtinDir });
      assert.deepEqual(
        plugins.map((p) => p.name),
        ["alpha"],
      );
    } finally {
      console.error = originalError;
    }

    assert.equal(
      errors.some((args) => String(args[0]).includes("_shared")),
      false,
    );
  });
});
