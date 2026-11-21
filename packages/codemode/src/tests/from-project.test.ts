/**
 * `Codemode.fromProject` should register project-local plugins plus the
 * builtins named by `.codemode/config.json` connections — never the full
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
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setProjectTrusted } from "../config/trust.js";
import { Codemode } from "../sdk.js";

describe("Codemode.fromProject", () => {
  let tempDir: string;
  let builtinDir: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tempDir = join(tmpdir(), `codemode-fromproject-${stamp}`);
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

  /** The fake builtins, an empty folder in place of the real `~/.codemode`, and a trusted project. */
  function isolated() {
    return {
      builtinDir,
      userDir: join(tempDir, "home", ".codemode"),
      trust: () => true,
    };
  }

  function writeCodemodeDir(cfg: object) {
    const dir = join(tempDir, ".codemode");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
    return dir;
  }

  it("returns null when no .codemode directory is present", async () => {
    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.equal(rl, null);
  });

  it("only registers builtins referenced by config.connections", async () => {
    writeCodemodeDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl, "expected Codemode instance");

    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"), "alpha should be registered");
    assert.equal(
      names.has("beta"),
      false,
      "non-allowlisted builtin beta should NOT be registered",
    );
  });

  it("registers no builtins when connections are empty", async () => {
    writeCodemodeDir({ connections: [] });
    const rl = await Codemode.fromProject(tempDir, isolated());
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
    writeCodemodeDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      const rl = await Codemode.fromProject(tempDir, isolated());
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
    const codemodeDir = writeCodemodeDir({ connections: [] });
    const marker = join(tempDir, "imported");
    mkdirSync(join(codemodeDir, "plugins"), { recursive: true });
    writeFileSync(
      join(codemodeDir, "plugins", "localOnly.js"),
      `import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(marker)}, "");
      export default function localOnly(api) {
        api.setName("localOnly");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    const userDir = join(tempDir, "home", ".codemode");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      // No decision recorded: nothing of the project is imported.
      const untrusted = await Codemode.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(untrusted?.plugins(), []);
      assert.equal(existsSync(marker), false);
      assert.match(errors.join("\n"), /not loaded: the project is not trusted/);

      // The decision `codemode trust` records in the user's folder.
      setProjectTrusted(codemodeDir, true, userDir);
      const trusted = await Codemode.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(
        trusted?.plugins().map((p) => p.name),
        ["localOnly"],
      );
      assert.equal(existsSync(marker), true);

      setProjectTrusted(codemodeDir, false, userDir);
      const revoked = await Codemode.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(revoked?.plugins(), []);
    } finally {
      console.error = original;
    }
  });

  it("recognizes a trusted project reached through a symlink", async () => {
    const codemodeDir = writeCodemodeDir({ connections: [] });
    mkdirSync(join(codemodeDir, "plugins"), { recursive: true });
    writeFileSync(
      join(codemodeDir, "plugins", "localOnly.js"),
      `export default function localOnly(api) {
        api.setName("localOnly");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    const userDir = join(tempDir, "home", ".codemode");
    const linked = `${tempDir}-link`;
    symlinkSync(tempDir, linked);
    try {
      // Trusted under one path, opened under the other: one project.
      setProjectTrusted(join(linked, ".codemode"), true, userDir);
      const direct = await Codemode.fromProject(tempDir, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(
        direct?.plugins().map((p) => p.name),
        ["localOnly"],
      );
      const throughLink = await Codemode.fromProject(linked, {
        builtinDir,
        userDir,
      });
      assert.deepEqual(
        throughLink?.plugins().map((p) => p.name),
        ["localOnly"],
      );
    } finally {
      rmSync(linked, { force: true });
    }
  });

  it("still loads project-local plugins regardless of allowlist", async () => {
    // A plugin dropped into .codemode/plugins/ is user-installed and
    // should always load, even if its name isn't in connections[].
    const codemodeDir = writeCodemodeDir({ connections: [] });
    const pluginsDir = join(codemodeDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "localOnly.js"),
      `export default function localOnly(api) {
        api.setName("localOnly");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl);
    const names = rl.plugins().map((p) => p.name);
    assert.deepEqual(names, ["localOnly"]);
  });

  it("merges project-local plugins with allowlisted builtins", async () => {
    const codemodeDir = writeCodemodeDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    const pluginsDir = join(codemodeDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "customTool.js"),
      `export default function customTool(api) {
        api.setName("customTool");
        api.registerAction("run", { execute: () => null });
      }`,
    );

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl);
    const names = new Set(rl.plugins().map((p) => p.name));
    assert.ok(names.has("alpha"));
    assert.ok(names.has("customTool"));
    assert.equal(names.has("beta"), false);
  });

  it("project-local plugin replaces a same-named builtin the config lists as replaceable", async () => {
    // A plugin named "alpha" in .codemode/plugins/ takes the builtin's
    // name, and with it the builtin's connection, only by explicit config.
    const codemodeDir = writeCodemodeDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
      replaceableBuiltins: ["alpha"],
    });
    const pluginsDir = join(codemodeDir, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, "alpha.js"),
      `export default function alpha(api) {
        api.setName("alpha");
        api.setVersion("9.9.9");
        api.registerAction("override", { execute: () => "local" });
      }`,
    );

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl);
    const alpha = rl.plugins().find((p) => p.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.version, "9.9.9");
    assert.deepEqual(alpha.actions, ["override"]);
  });

  it("keeps the builtin when a same-named project-local plugin is not listed as replaceable", async () => {
    const codemodeDir = writeCodemodeDir({
      connections: [{ name: "alpha", plugin: "alpha", config: {} }],
    });
    mkdirSync(join(codemodeDir, "plugins"), { recursive: true });
    writeFileSync(
      join(codemodeDir, "plugins", "alpha.js"),
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
      const rl = await Codemode.fromProject(tempDir, isolated());
      const alpha = rl?.plugins().find((p) => p.name === "alpha");
      assert.equal(alpha?.sourceInfo?.origin, "builtin");
      assert.notEqual(alpha?.version, "9.9.9");
    } finally {
      console.error = original;
    }
    assert.match(errors.join("\n"), /has the name of a bundled plugin/);
  });
});
