import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { FileConnectionProvider } from "../connections/file.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import type { ConnectionProvider } from "../connections/types.js";
import type { RunlinePluginAPI } from "../plugin/api.js";
import { Runline } from "../sdk.js";

const seed = () => [
  { name: "account", plugin: "probe", config: { refreshToken: "r1" } },
];

function probe(api: RunlinePluginAPI) {
  api.setName("probe");
  api.setConnectionSchema({
    refreshToken: { type: "string", env: "RUNLINE_PROVIDER_TEST_TOKEN" },
  });
  api.registerAction("read", {
    execute: (_input, ctx) => ctx.connection.config,
  });
  api.registerAction("refresh", {
    async execute(_input, ctx) {
      await ctx.updateConnection(async (current) => {
        if (current.accessToken) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { accessToken: "a1", refreshToken: "r2" };
      });
      return ctx.connection.config;
    },
  });
}

describe("host-owned connections", () => {
  it("rejects mismatched provider identities on read and update", async () => {
    for (const wrongRead of [true, false]) {
      const rl = Runline.create({
        plugins: [probe],
        connectionProvider: {
          async resolve() {
            return {
              async read() {
                return { ...seed()[0], plugin: wrongRead ? "other" : "probe" };
              },
              async update() {
                return { ...seed()[0], name: "other-account" };
              },
            };
          },
        },
      });
      try {
        assert.match(
          (await rl.execute("return await probe.refresh()")).error ?? "",
          wrongRead ? /wrong plugin/ : /changed identity/,
        );
      } finally {
        rl.dispose();
      }
    }
  });

  it("does not resolve credentials for unknown actions", async () => {
    let resolved = false;
    const rl = Runline.create({
      plugins: [probe],
      connectionProvider: {
        async resolve() {
          resolved = true;
          throw new Error("unexpected resolution");
        },
      },
    });
    try {
      assert.match(
        (await rl.execute("return await probe.missing()")).error ?? "",
        /Unknown action/,
      );
      assert.equal(resolved, false);
    } finally {
      rl.dispose();
    }
  });
  it("retains updates across SDK calls without touching the working directory", async () => {
    const previous = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "runline-memory-"));
    process.chdir(dir);
    const rl = Runline.create({ plugins: [probe], connections: seed() });
    try {
      assert.equal(
        (await rl.execute("return await probe.refresh()")).error,
        undefined,
      );
      const out = await rl.execute("return await probe.read()");
      assert.deepEqual(out.result, { accessToken: "a1", refreshToken: "r2" });
      assert.equal(existsSync(join(dir, ".runline")), false);
      assert.equal(rl.connections()[0].config.refreshToken, "r2");
    } finally {
      rl.dispose();
      process.chdir(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves by host context for every invocation and never falls back on denial", async () => {
    const alice = new MemoryConnectionProvider(seed());
    const bob = new MemoryConnectionProvider([
      { name: "account", plugin: "probe", config: { refreshToken: "bob" } },
    ]);
    const seen: unknown[] = [];
    const connections: ConnectionProvider = {
      async resolve(request) {
        seen.push(request.context);
        if (request.context === "alice") return alice.resolve(request);
        if (request.context === "bob") return bob.resolve(request);
        throw new Error("Credential access denied");
      },
    };
    const rl = Runline.create({
      plugins: [probe],
      connectionProvider: connections,
    });
    try {
      const results = await Promise.all(
        ["alice", "bob"].map((context) =>
          rl.execute("return await probe.read()", { context }),
        ),
      );
      assert.deepEqual(
        results.map((out) => out.result),
        [{ refreshToken: "r1" }, { refreshToken: "bob" }],
      );
      assert.match(
        (await rl.execute("return await probe.read()")).error ?? "",
        /Credential access denied/,
      );
      assert.deepEqual(new Set(seen), new Set(["alice", "bob", undefined]));
    } finally {
      rl.dispose();
    }
  });

  it("serializes the whole refresh and re-reads under ownership across SDK instances", async () => {
    const provider = new MemoryConnectionProvider(seed());
    let refreshes = 0;
    const plugin = (api: RunlinePluginAPI) => {
      api.setName("probe");
      api.registerAction("refresh", {
        async execute(_input, ctx) {
          await ctx.updateConnection(async (current) => {
            if (current.accessToken) return;
            refreshes++;
            await new Promise((resolve) => setTimeout(resolve, 15));
            assert.equal(current.refreshToken, "r1");
            return { accessToken: "a1", refreshToken: "r2" };
          });
          return ctx.connection.config.accessToken;
        },
      });
    };
    const engines = Array.from({ length: 3 }, () =>
      Runline.create({ plugins: [plugin], connectionProvider: provider }),
    );
    try {
      const results = await Promise.all(
        engines.map((rl) => rl.execute("return await probe.refresh()")),
      );
      assert.deepEqual(
        results.map((out) => out.result),
        ["a1", "a1", "a1"],
      );
      assert.equal(refreshes, 1);
    } finally {
      for (const rl of engines) rl.dispose();
    }
  });

  it("does not mutate the action snapshot when persistence fails", async () => {
    const provider: ConnectionProvider = {
      async resolve() {
        return {
          async read() {
            return seed()[0];
          },
          async update() {
            throw new Error("Store unavailable");
          },
        };
      },
    };
    const plugin = (api: RunlinePluginAPI) => {
      api.setName("probe");
      api.registerAction("fail", {
        async execute(_input, ctx) {
          await assert.rejects(
            ctx.updateConnection({ refreshToken: "lost" }),
            /Store unavailable/,
          );
          return ctx.connection.config.refreshToken;
        },
      });
    };
    const rl = Runline.create({
      plugins: [plugin],
      connectionProvider: provider,
    });
    try {
      assert.equal(
        (await rl.execute("return await probe.fail()")).result,
        "r1",
      );
    } finally {
      rl.dispose();
    }
  });
});

describe("connection adapters", () => {
  it("keeps SDK connections independent of ambient environment credentials", async () => {
    const previous = process.env.RUNLINE_PROVIDER_TEST_TOKEN;
    process.env.RUNLINE_PROVIDER_TEST_TOKEN = "ambient-secret";
    const rl = Runline.create({ plugins: [probe] });
    try {
      assert.deepEqual(
        (await rl.execute("return await probe.read()")).result,
        {},
      );
    } finally {
      rl.dispose();
      if (previous === undefined)
        delete process.env.RUNLINE_PROVIDER_TEST_TOKEN;
      else process.env.RUNLINE_PROVIDER_TEST_TOKEN = previous;
    }
  });

  it("retains committed memory state when the engine is recreated", async () => {
    const rl = Runline.create({ plugins: [probe], connections: seed() });
    try {
      await rl.execute("return await probe.refresh()");
      rl.dispose();
      assert.equal(
        (await rl.execute("return await probe.read()")).error,
        undefined,
      );
      assert.equal(rl.connections()[0].config.refreshToken, "r2");
      const snapshot = rl.connections();
      snapshot[0].config.refreshToken = "changed";
      assert.equal(rl.connections()[0].config.refreshToken, "r2");
    } finally {
      rl.dispose();
    }
  });

  it("rejects ambiguous SDK ownership", () => {
    assert.throws(
      () =>
        Runline.create({
          connections: seed(),
          connectionProvider: new MemoryConnectionProvider(),
        }),
      /not both/,
    );
    assert.throws(
      () => new MemoryConnectionProvider([...seed(), ...seed()]),
      /Duplicate connection/,
    );
  });

  it("uses the file selected by fromProject, not the current working directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runline-project-"));
    const configDir = join(dir, ".runline");
    const pluginDir = join(configDir, "plugins", "probe");
    mkdirSync(pluginDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ connections: seed() }));
    writeFileSync(
      join(pluginDir, "index.js"),
      `export default {
      name: "probe", version: "1", actions: [{ name: "refresh", async execute(_, ctx) {
        await ctx.updateConnection({ refreshToken: "r2" });
        return ctx.connection.config.refreshToken;
      } }]
    };`,
    );
    const rl = await Runline.fromProject(dir, {
      builtinDir: join(dir, "empty-builtins"),
    });
    try {
      assert.ok(rl);
      const out = await rl.execute("return await probe.refresh()");
      assert.equal(out.error, undefined);
      assert.equal(out.result, "r2");
      assert.equal(
        JSON.parse(readFileSync(configPath, "utf8")).connections[0].config
          .refreshToken,
        "r2",
      );
    } finally {
      rl?.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("isolates memory snapshots and releases ownership after a failed updater", async () => {
    const initial = seed();
    const provider = new MemoryConnectionProvider(initial);
    initial[0].config.refreshToken = "mutated";
    const handle = await provider.resolve({ plugin: "probe" });
    const snapshot = await handle.read();
    snapshot.config.refreshToken = "also mutated";
    await assert.rejects(
      handle.update(async () => {
        throw new Error("offline");
      }),
      /offline/,
    );
    assert.equal((await handle.read()).config.refreshToken, "r1");
    assert.equal(
      (await handle.update({ refreshToken: "r2" })).config.refreshToken,
      "r2",
    );
  });

  it("pins file storage to an explicit path and preserves unrelated settings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runline-file-"));
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({ connections: seed(), timeoutMs: 1234 }),
    );
    try {
      const provider = new FileConnectionProvider(path);
      const handle = await provider.resolve({ plugin: "probe" });
      await handle.update({ refreshToken: "r2" });
      const stored = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(stored.timeoutMs, 1234);
      assert.equal(stored.connections[0].config.refreshToken, "r2");
      writeFileSync(path, JSON.stringify({ connections: [] }));
      await assert.rejects(
        handle.update({ refreshToken: "resurrected" }),
        /not found/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("coordinates separate file adapters across the network operation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runline-file-lock-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ connections: seed() }));
    let refreshes = 0;
    try {
      const handles = await Promise.all(
        [1, 2, 3].map(() =>
          new FileConnectionProvider(path).resolve({ plugin: "probe" }),
        ),
      );
      const results = await Promise.all(
        handles.map((handle) =>
          handle.update(async (current) => {
            if (current.accessToken) return;
            refreshes++;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { accessToken: "a1", refreshToken: "r2" };
          }),
        ),
      );
      assert.equal(refreshes, 1);
      assert.ok(results.every((value) => value.config.refreshToken === "r2"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("coordinates refreshes across actual processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runline-process-lock-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ connections: seed() }));
    const source = new URL("../connections/file.ts", import.meta.url).href;
    const code = `
      import { FileConnectionProvider } from ${JSON.stringify(source)};
      const handle = await new FileConnectionProvider(${JSON.stringify(path)}).resolve({ plugin: "probe" });
      await handle.update(async (current) => {
        if (current.accessToken) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { accessToken: "a1", refreshToken: "r2", refreshes: Number(current.refreshes ?? 0) + 1 };
      });
    `;
    try {
      await Promise.all(
        [1, 2, 3].map(() =>
          promisify(execFile)(process.execPath, ["--eval", code], {
            timeout: 15_000,
          }),
        ),
      );
      const stored = JSON.parse(readFileSync(path, "utf8")).connections[0]
        .config;
      assert.equal(stored.refreshToken, "r2");
      assert.equal(stored.refreshes, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on malformed storage without overwriting it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runline-file-invalid-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{broken");
    try {
      await assert.rejects(
        new FileConnectionProvider(path).resolve({ plugin: "probe" }),
        { message: "Invalid connection file: unreadable or malformed JSON" },
      );
      assert.equal(readFileSync(path, "utf8"), "{broken");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
