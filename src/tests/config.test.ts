import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { applyEnvOverrides } from "../config/loader.js";
import { DEFAULT_CONFIG } from "../config/types.js";

describe("DEFAULT_CONFIG", () => {
  it("has sensible defaults", () => {
    assert.equal(DEFAULT_CONFIG.timeoutMs, 30_000);
    assert.equal(DEFAULT_CONFIG.memoryLimitBytes, 64 * 1024 * 1024);
    assert.deepEqual(DEFAULT_CONFIG.connections, []);
  });
});

describe("applyEnvOverrides", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("applies env var when config value is missing", () => {
    process.env.MY_TOKEN = "secret123";
    const conn = { name: "gh", plugin: "github", config: {} };
    const schema = { token: { env: "MY_TOKEN" } };

    const result = applyEnvOverrides(conn, schema);
    assert.equal(result.config.token, "secret123");
  });

  it("does not override existing config values", () => {
    process.env.MY_TOKEN = "from-env";
    const conn = {
      name: "gh",
      plugin: "github",
      config: { token: "from-config" },
    };
    const schema = { token: { env: "MY_TOKEN" } };

    const result = applyEnvOverrides(conn, schema);
    assert.equal(result.config.token, "from-config");
  });

  it("returns connection unchanged when no schema", () => {
    const conn = { name: "gh", plugin: "github", config: { x: 1 } };
    const result = applyEnvOverrides(conn, undefined);
    assert.deepEqual(result, conn);
  });

  it("skips fields without env key", () => {
    const conn = { name: "gh", plugin: "github", config: {} };
    const schema = { token: {} };

    const result = applyEnvOverrides(conn, schema);
    assert.equal(result.config.token, undefined);
  });

  it("does not mutate the original connection", () => {
    process.env.MY_KEY = "injected";
    const conn = { name: "x", plugin: "y", config: {} };
    const schema = { apiKey: { env: "MY_KEY" } };

    applyEnvOverrides(conn, schema);
    assert.equal(conn.config.apiKey, undefined);
  });
});
