import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { PluginRegistry } from "../plugin/registry.js";

async function run<T = unknown>(code: string): Promise<T> {
  const registry = new PluginRegistry();
  const engine = new ExecutionEngine(registry, {
    ...DEFAULT_CONFIG,
    timeoutMs: 5000,
  });
  const result = await engine.execute(code);
  assert.equal(result.error, undefined, result.error);
  return result.result as T;
}

describe("built-in node plugin", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `runline-node-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("is available as a top-level global without explicit registration", async () => {
    const result = await run<string>("return await node.os.platform()");
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });

  it("supports agent-critical filesystem actions", async () => {
    const file = join(dir, "notes.txt");
    const result = await run<{
      text: string;
      exists: boolean;
      stat: { isFile: boolean; size: number };
    }>(`
      await node.fs.writeFile({ path: ${JSON.stringify(file)}, data: "hello" });
      const text = await node.fs.readFile({ path: ${JSON.stringify(file)} });
      const exists = await node.fs.exists({ path: ${JSON.stringify(file)} });
      const stat = await node.fs.stat({ path: ${JSON.stringify(file)} });
      return { text, exists, stat };
    `);

    assert.deepEqual(result, {
      text: "hello",
      exists: true,
      stat: { ...result.stat, isFile: true, size: 5 },
    });
  });

  it("supports path helpers", async () => {
    const result = await run<{
      joined: string;
      base: string;
      absolute: boolean;
    }>(`
      const joined = await node.path.join({ segments: ["a", "b", "c.txt"] });
      const base = await node.path.basename({ path: joined });
      const absolute = await node.path.isAbsolute({ path: joined });
      return { joined, base, absolute };
    `);

    assert.equal(result.joined, join("a", "b", "c.txt"));
    assert.equal(result.base, "c.txt");
    assert.equal(result.absolute, false);
  });

  it("supports shell execution", async () => {
    const result = await run<{ stdout: string; stderr: string }>(`
      return await node.process.execFile({ file: "node", args: ["-e", "process.stdout.write('ok')"] });
    `);

    assert.equal(result.stdout, "ok");
    assert.equal(result.stderr, "");
  });

  it("supports crypto helpers", async () => {
    const result = await run<{ hash: string; bytes: string; id: string }>(`
      const hash = await node.crypto.hash({ data: "hello" });
      const bytes = await node.crypto.randomBytes({ size: 4 });
      const id = await node.crypto.randomUUID();
      return { hash, bytes, id };
    `);

    assert.equal(
      result.hash,
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    assert.match(result.bytes, /^[a-f0-9]{8}$/);
    assert.match(result.id, /^[0-9a-f-]{36}$/);
  });

  it("supports host fetch", async () => {
    const result = await run<{ ok: boolean; status: number; body: string }>(`
      return await node.fetch({ url: "data:text/plain,hello" });
    `);

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.body, "hello");
  });

  it("appears in the sandbox action discovery API", async () => {
    const actions = await run<string[]>("return actions.list('node')");
    assert.ok(actions.includes("node.fs.readFile"));
    assert.ok(actions.includes("node.process.execFile"));
    assert.ok(actions.includes("node.crypto.hash"));
    assert.ok(actions.includes("node.fetch"));
  });
});
