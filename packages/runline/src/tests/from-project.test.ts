/**
 * `Runline.fromProject` should register project-local plugins plus the
 * builtins named by `.runline/config.json` connections — never the full
 * bundled catalog.
 *
 * Ungated, `rl.actions()` would return every action shipped with the
 * package regardless of what a workspace had configured.
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
import { setProjectTrusted } from "../config/trust.js";
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

  /** The fake builtins, an empty folder in place of the real `~/.runline`, and a trusted project. */
  function isolated() {
    return {
      builtinDir,
      userDir: join(tempDir, "home", ".runline"),
      trust: () => true,
    };
  }

  function writeRunlineDir(cfg: object) {
    const dir = join(tempDir, ".runline");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
    return dir;
  }

  it("returns null when no .runline directory is present", async () => {
    const rl = await Runline.fromProject(tempDir, isolated());
    assert.equal(rl, null);
  });

  it("only registers builtins referenced by config.connections", async () => {
    writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });

    const rl = await Runline.fromProject(tempDir, isolated());
    assert.ok(rl, "expected Runline instance");

    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"), "alpha should be registered");
    assert.equal(
      names.has("beta"),
      false,
      "non-allowlisted builtin beta should NOT be registered",
    );
  });

  it("registers no builtins when connections are empty", async () => {
    writeRunlineDir({ connections: [] });
    const rl = await Runline.fromProject(tempDir, isolated());
    assert.ok(rl);
    assert.equal(
      rl.plugins().length,
      0,
      "empty connections should yield no builtins",
    );
    assert.equal(rl.actions().length, 0);
  });

  it("imports no bundled plugin the connections do not name", async () => {
    // A bundled plugin that is not asked for is not even imported.
    writeFileSync(join(builtinDir, "gamma.js"), `throw new Error("imported");`);
    writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      const rl = await Runline.fromProject(tempDir, isolated());
      assert.deepEqual(
        rl?.plugins().map((p) => p.name),
        ["alpha"],
      );
    } finally {
      console.error = original;
    }
    assert.deepEqual(errors, []);
  });

  it("loads a project's plugin files only once the project is trusted", async () => {
    const runlineDir = writeRunlineDir({ connections: [] });
    const marker = join(tempDir, "imported");
    mkdirSync(join(runlineDir, "plugins"), { recursive: true });
    writeFileSync(
      join(runlineDir, "plugins", "localOnly.js"),
      `import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(marker)}, "");
      export default function localOnly(api) {
        api.setName("localOnly");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    const userDir = join(tempDir, "home", ".runline");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      // No decision recorded: nothing of the project is imported.
      const untrusted = await Runline.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(untrusted?.plugins(), []);
      assert.equal(existsSync(marker), false);
      assert.match(errors.join("\n"), /not loaded: the project is not trusted/);

      // The decision `runline trust` records in the user's folder.
      setProjectTrusted(runlineDir, true, userDir);
      const trusted = await Runline.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(
        trusted?.plugins().map((p) => p.name),
        ["localOnly"],
      );
      assert.equal(existsSync(marker), true);

      setProjectTrusted(runlineDir, false, userDir);
      const revoked = await Runline.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(revoked?.plugins(), []);
    } finally {
      console.error = original;
    }
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

    const rl = await Runline.fromProject(tempDir, isolated());
    assert.ok(rl);
    const names = rl.plugins().map((p) => p.name);
    assert.deepEqual(names, ["localOnly"]);
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

    const rl = await Runline.fromProject(tempDir, isolated());
    assert.ok(rl);
    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"));
    assert.ok(names.has("customTool"));
    assert.equal(names.has("beta"), false);
  });

  it("project-local plugin replaces a same-named builtin the config lists as replaceable", async () => {
    // A plugin named "alpha" in .runline/plugins/ takes the builtin's
    // name, and with it the builtin's connection, only by explicit config.
    const runlineDir = writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
      replaceableBuiltins: ["alpha"],
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

    const rl = await Runline.fromProject(tempDir, isolated());
    assert.ok(rl);
    const alpha = rl.plugins().find((p) => p.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.version, "9.9.9");
    assert.deepEqual(alpha.actions, ["override"]);
  });

  it("keeps the builtin when a same-named project-local plugin is not listed as replaceable", async () => {
    const runlineDir = writeRunlineDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    mkdirSync(join(runlineDir, "plugins"), { recursive: true });
    writeFileSync(
      join(runlineDir, "plugins", "alpha.js"),
      `export default function alpha(api) {
        api.setName("alpha");
        api.setVersion("9.9.9");
        api.registerAction("override", { execute: () => "local" });
      }`,
    );

    const original = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      const rl = await Runline.fromProject(tempDir, isolated());
      const alpha = rl?.plugins().find((p) => p.name === "alpha");
      assert.equal(alpha?.sourceInfo?.origin, "builtin");
      assert.notEqual(alpha?.version, "9.9.9");
    } finally {
      console.error = original;
    }
    assert.match(errors.join("\n"), /has the name of a bundled plugin/);
  });
});
