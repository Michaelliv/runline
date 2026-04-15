import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadPluginFromPath } from "../plugin/loader.js";

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
});
