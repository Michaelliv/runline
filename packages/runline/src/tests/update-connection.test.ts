import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  addConnection,
  loadConfig,
  updateConnectionConfig,
} from "../config/loader.js";
import { ExecutionEngine } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";

describe("updateConnectionConfig", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = join(tmpdir(), `runline-conn-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tempDir, ".runline"), { recursive: true });
    writeFileSync(
      join(tempDir, ".runline", "config.json"),
      JSON.stringify({ connections: [], timeoutMs: 5000 }, null, 2),
    );
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("merges a patch into an existing connection", async () => {
    addConnection("gm", "gmail", { clientId: "abc", refreshToken: "r1" });
    await updateConnectionConfig("gm", {
      accessToken: "a1",
      expiresAt: 1234,
    });

    const cfg = loadConfig();
    const conn = cfg.connections.find((c) => c.name === "gm");
    assert.deepEqual(conn?.config, {
      clientId: "abc",
      refreshToken: "r1",
      accessToken: "a1",
      expiresAt: 1234,
    });
  });

  it("overwrites existing keys", async () => {
    addConnection("gm", "gmail", { accessToken: "old", expiresAt: 1 });
    await updateConnectionConfig("gm", { accessToken: "new", expiresAt: 2 });

    const cfg = loadConfig();
    const conn = cfg.connections.find((c) => c.name === "gm");
    assert.equal(conn?.config.accessToken, "new");
    assert.equal(conn?.config.expiresAt, 2);
  });

  it("is a no-op for unknown connections", async () => {
    addConnection("gm", "gmail", { clientId: "abc" });
    await updateConnectionConfig("nope", { accessToken: "x" });

    const cfg = loadConfig();
    assert.equal(cfg.connections.length, 1);
    assert.equal(cfg.connections[0].name, "gm");
    assert.equal(cfg.connections[0].config.accessToken, undefined);
  });

  it("writes valid JSON with trailing newline", async () => {
    addConnection("gm", "gmail", {});
    await updateConnectionConfig("gm", { token: "x" });

    const raw = readFileSync(join(tempDir, ".runline", "config.json"), "utf-8");
    assert.ok(raw.endsWith("\n"));
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

describe("ActionContext.updateConnection", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = join(tmpdir(), `runline-ctx-${Date.now()}-${Math.random()}`);
    mkdirSync(join(tempDir, ".runline"), { recursive: true });
    writeFileSync(
      join(tempDir, ".runline", "config.json"),
      JSON.stringify({ connections: [], timeoutMs: 5000 }, null, 2),
    );
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists and mutates in-memory connection during an action", async () => {
    addConnection("gm", "gmail", { refreshToken: "r1", accessToken: "old" });

    const { api, resolve } = createPluginAPI("gmail");
    api.setName("gmail");
    api.registerAction("probe", {
      async execute(_input, ctx) {
        assert.equal(ctx.connection.config.accessToken, "old");
        await ctx.updateConnection({ accessToken: "fresh", expiresAt: 42 });
        // Mutation visible inside the same action call.
        assert.equal(ctx.connection.config.accessToken, "fresh");
        return ctx.connection.config.accessToken;
      },
    });

    const registry = new PluginRegistry();
    registry.register(resolve());
    const engine = new ExecutionEngine(registry, loadConfig());

    const result = await engine.execute("return await gmail.probe()");
    assert.equal(result.error, undefined);
    assert.equal(result.result, "fresh");

    // And persisted to disk for the next process.
    const cfg = loadConfig();
    const conn = cfg.connections.find((c) => c.name === "gm");
    assert.equal(conn?.config.accessToken, "fresh");
    assert.equal(conn?.config.expiresAt, 42);
  });
});
