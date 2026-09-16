import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { connectionList } from "../commands/connection.js";
import {
  addConnection,
  getConnection,
  loadConfig,
  removeConnection,
  saveConfig,
  updateConnectionConfig,
} from "../config/loader.js";
import { FileConnectionProvider } from "../connections/file.js";
import { Runline } from "../sdk.js";

describe("coordinated config storage", () => {
  let cwd: string;
  let dir: string;
  let path: string;
  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "runline-storage-"));
    path = join(dir, ".runline", "config.json");
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates private storage and coordinates simultaneous administrative writes", async () => {
    await Promise.all([
      addConnection("a", "probe", {}),
      addConnection("b", "other", {}),
    ]);
    assert.deepEqual(
      new Set(loadConfig().connections.map((c) => c.name)),
      new Set(["a", "b"]),
    );
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(getConnection("other", "a"), undefined);
    assert.equal(await removeConnection("a"), true);
    assert.equal(await removeConnection("a"), false);
  });

  it("lists config keys without leaking short, nested, or partial credentials", async () => {
    await addConnection("a", "probe", {
      short: "abc",
      long: "private-token",
      nested: { token: "nested-secret" },
    });
    const original = console.log;
    const lines: string[] = [];
    console.log = (value) => {
      lines.push(String(value));
    };
    try {
      await connectionList({ json: true });
    } finally {
      console.log = original;
    }
    assert.deepEqual(JSON.parse(lines.join("")), [
      {
        name: "a",
        plugin: "probe",
        config: {
          short: "[redacted]",
          long: "[redacted]",
          nested: "[redacted]",
        },
      },
    ]);
  });

  it("fences old handles after reconnect and full config replacement", async () => {
    await addConnection("a", "probe", { token: "old" });
    const provider = new FileConnectionProvider(path);
    const old = await provider.resolve({ plugin: "probe" });
    await removeConnection("a");
    await addConnection("a", "probe", { token: "new" });
    await assert.rejects(old.read(), /not found/);
    let called = false;
    await assert.rejects(
      old.update(() => {
        called = true;
        return { token: "stale" };
      }),
      /not found/,
    );
    assert.equal(called, false);
    const current = await provider.resolve({ plugin: "probe" });
    await saveConfig(loadConfig());
    await assert.rejects(current.update({ token: "stale" }), /not found/);
    assert.equal(loadConfig().connections[0].config.token, "new");
  });

  it("does not attach a credential-free handle to a later account", async () => {
    const request = { plugin: "probe" };
    const handle = await new FileConnectionProvider(path).resolve(request);
    request.plugin = "other";
    await addConnection("probe", "probe", { token: "secret" });
    assert.deepEqual(await handle.read(), {
      name: "probe",
      plugin: "probe",
      config: {},
    });
    await assert.rejects(handle.update({ token: "replacement" }), /not found/);
  });

  it("administrative writes wait for the entire refresh, then preserve its fields", async () => {
    await addConnection("a", "probe", { refreshToken: "r1" });
    const handle = await new FileConnectionProvider(path).resolve({
      plugin: "probe",
    });
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const finished = new Promise<void>((r) => {
      finish = r;
    });
    const refreshing = handle.update(async () => {
      enter();
      await finished;
      return { refreshToken: "r2" };
    });
    await entered;
    const editing = updateConnectionConfig("a", { setting: "kept" });
    const adding = addConnection("b", "other", {});
    finish();
    await Promise.all([refreshing, editing, adding]);
    assert.deepEqual(getConnection("probe")?.config, {
      refreshToken: "r2",
      setting: "kept",
    });
    assert.equal(loadConfig().connections.length, 2);
  });

  it("does not persist an updater that throws, and releases ownership", async () => {
    await addConnection("a", "probe", { token: "old" });
    const handle = await new FileConnectionProvider(path).resolve({
      plugin: "probe",
    });
    let calls = 0;
    await assert.rejects(
      handle.update(() => {
        calls++;
        throw new Error("failed");
      }),
      /failed/,
    );
    assert.equal(calls, 1);
    assert.equal((await handle.read()).config.token, "old");
    await handle.update({ token: "new" });
    assert.equal((await handle.read()).config.token, "new");
  });

  it("rejects malformed storage through every reader and writer without exposing it", async () => {
    mkdirSync(join(dir, ".runline"));
    const text = '{"secret":"private-token",broken';
    writeFileSync(path, text);
    assert.throws(() => loadConfig(), {
      message: "Invalid connection file: unreadable or malformed JSON",
    });
    await assert.rejects(
      addConnection("a", "probe", {}),
      /Invalid connection file/,
    );
    await assert.rejects(removeConnection("a"), /Invalid connection file/);
    await assert.rejects(
      updateConnectionConfig("a", {}),
      /Invalid connection file/,
    );
    await assert.rejects(Runline.fromProject(dir), /Invalid connection file/);
    assert.equal(readFileSync(path, "utf8"), text);
  });

  it("accepts settings-only config files with no shared default connection array", async () => {
    mkdirSync(join(dir, ".runline"));
    writeFileSync(path, JSON.stringify({ timeoutMs: 7 }));
    const config = loadConfig();
    config.connections.push({ name: "x", plugin: "probe", config: {} });
    assert.deepEqual(loadConfig().connections, []);
    await addConnection("a", "probe", {});
    assert.equal(loadConfig().timeoutMs, 7);
  });
});
