/**
 * `Runline.fromProject` should register project-local plugins plus the
 * builtins named by `.runline/config.json` connections — never the full
 * bundled catalog.
 *
 * Regression test for the "agent sees all 188 plugins" bug: before
 * builtins were gated, `rl.actions()` returned every action shipped
 * with the package regardless of what a workspace had configured.
 *
 * These tests don't rely on the real bundled plugins (which only
 * exist under `dist/` after a build). They stand up a fake builtin
 * directory with two plugins and pass it to `fromProject` via the
 * test-only `builtinDir` hook.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Runline } from "../sdk.js";

describe("Runline.fromProject", () => {
  let tempDir: string;
  let builtinDir: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tempDir = join(tmpdir(), `runline-fromproject-${stamp}`);
    mkdirSync(tempDir, { recursive: true });

    // Fake builtin catalog: "alpha" and "beta" plugins. Anything not
    // allowlisted by the project's connections should be filtered out.
    builtinDir = join(tempDir, "fake-builtins");
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(
      join(builtinDir, "alpha.js"),
      `export default function alpha(api) {
        api.setName("alpha");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(
      join(builtinDir, "beta.js"),
      `export default function beta(api) {
        api.setName("beta");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  function writeRunlineDir(cfg: object) {
    const dir = join(tempDir, ".runline");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
    return dir;
  }

  it("returns null when no .runline directory is present", async () => {
    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.equal(rl, null);
  });

  it("only registers builtins referenced by config.connections", async () => {
    writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });

    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.ok(rl, "expected Runline instance");

    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"), "alpha should be registered");
    assert.equal(
      names.has("beta"),
      false,
      "non-allowlisted builtin beta should NOT be registered",
    );
  });

  it("registers only native node when builtin connections are empty", async () => {
    writeRunlineDir({ connections: [] });
    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.ok(rl);
    const names = rl.plugins().map((p) => p.name);
    assert.deepEqual(names, ["node"]);
    assert.ok(rl.actions().some((a) => a.plugin === "node"));
  });

  it("still loads project-local plugins regardless of allowlist", async () => {
    // A plugin dropped into .runline/plugins/ is user-installed and
    // should always load, even if its name isn't in connections[].
    const runlineDir = writeRunlineDir({ connections: [] });
    const pluginsDir = join(runlineDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "localOnly.js"),
      `export default function localOnly(api) {
        api.setName("localOnly");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.ok(rl);
    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("node"));
    assert.ok(names.has("localOnly"));
  });

  it("merges project-local plugins with allowlisted builtins", async () => {
    const runlineDir = writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    const pluginsDir = join(runlineDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "customTool.js"),
      `export default function customTool(api) {
        api.setName("customTool");
        api.registerAction("run", { execute: () => null });
      }`,
    );

    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.ok(rl);
    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"));
    assert.ok(names.has("customTool"));
    assert.equal(names.has("beta"), false);
  });

  it("project-local plugin overrides a same-named builtin", async () => {
    // If a user drops a plugin named "alpha" into .runline/plugins/,
    // it should win over the builtin — project code is closer to the
    // user's intent.
    const runlineDir = writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    const pluginsDir = join(runlineDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "alpha.js"),
      `export default function alpha(api) {
        api.setName("alpha");
        api.setVersion("9.9.9");
        api.registerAction("override", { execute: () => "local" });
      }`,
    );

    const rl = await Runline.fromProject(tempDir, { builtinDir });
    assert.ok(rl);
    const alpha = rl.plugins().find((p) => p.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.version, "9.9.9");
    assert.deepEqual(alpha.actions, ["override"]);
  });
});
