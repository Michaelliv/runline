// The worker's environment is a leak surface, not a feature (vex
// SHFT-1125). Runline instances live inside credential-bearing hosts —
// vex's server process holds VEX_SECRET_KEY, the pi agent process holds
// the model provider key — and a worker_threads Worker created without
// an `env` option inherits a copy of the whole parent environment.
// Bodies get a real `require` and a live `process`, so one line of
// agent code reads any of it.
//
// Nothing in the worker needs an environment: actions execute host-side
// (engine.invokeAction), connection configs are hydrated host-side, and
// ferrosearch is required by absolute path. The worker therefore gets
// `env: {}` — empty by construction, not by scrubbing.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { PluginRegistry } from "../plugin/registry.js";

const HOST_SECRET = "RUNLINE_TEST_HOST_ONLY_SECRET";

describe("worker environment", () => {
  let engine: ExecutionEngine;

  beforeEach(() => {
    process.env[HOST_SECRET] = "s3cret-host-value";
    engine = new ExecutionEngine(new PluginRegistry(), { ...DEFAULT_CONFIG });
  });

  afterEach(() => {
    delete process.env[HOST_SECRET];
    engine.dispose();
  });

  test("a body cannot read the host's environment", async () => {
    const out = await engine.execute(
      `return process.env.${HOST_SECRET} ?? null;`,
    );
    expect(out.error).toBeUndefined();
    expect(out.result).toBeNull();
  });

  test("tripwire: the worker environment is empty, not merely filtered", async () => {
    // Default deny. A variable that shows up here six months from now
    // is a new leak, whatever its name — the assertion is the full
    // key set, so anything fails the suite instead of slipping through.
    const out = await engine.execute(`return Object.keys(process.env);`);
    expect(out.error).toBeUndefined();
    expect(out.result).toEqual([]);
  });

  test("require('node:process') is the same empty view", async () => {
    const out = await engine.execute(
      `return require("node:process").env.${HOST_SECRET} ?? null;`,
    );
    expect(out.error).toBeUndefined();
    expect(out.result).toBeNull();
  });
});
