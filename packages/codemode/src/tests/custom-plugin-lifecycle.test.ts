import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverPlugins, loadPluginFromPath } from "../plugin/loader.js";
import { Codemode } from "../sdk.js";
import { stubFetch } from "./helpers/plugin.js";

const originalEnv = { ...process.env };

function captureStderr() {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore() {
      console.error = original;
    },
  };
}

describe("custom plugin lifecycle", () => {
  let tempDir: string;
  let codemodeDir: string;
  let pluginsDir: string;
  let builtinDir: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    tempDir = join(tmpdir(), `codemode-custom-plugin-${stamp}`);
    codemodeDir = join(tempDir, ".codemode");
    pluginsDir = join(codemodeDir, "plugins");
    builtinDir = join(tempDir, "builtins");
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(builtinDir, { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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

  function writeConfig(connections: object[] = []) {
    writeFileSync(
      join(codemodeDir, "config.json"),
      JSON.stringify({ connections }),
    );
  }

  it("discovers a project-local plugin, describes its action schema, and executes it with connection config", async () => {
    writeConfig([
      {
        name: "inspector",
        plugin: "inspector",
        config: { token: "secret-token", region: "iad" },
      },
    ]);
    writeFileSync(
      join(pluginsDir, "inspector.ts"),
      `import type { CodemodePluginAPI } from "@shiftlabs/codemode";

export default function inspector(api: CodemodePluginAPI) {
  api.setName("inspector");
  api.setVersion("1.2.3");
  api.setConnectionSchema({ token: { type: "string", required: true, description: "API token" } });
  api.registerAction("echo", {
    description: "Echo input and connection config",
    inputSchema: {
      message: { type: "string", required: true, description: "Message to echo" },
      loud: { type: "boolean", description: "Uppercase output" },
    },
    execute(input, ctx) {
      const args = input as { message: string; loud?: boolean };
      return {
        message: args.loud ? args.message.toUpperCase() : args.message,
        connection: ctx.connection,
      };
    },
  });
}
`,
    );

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl);
    assert.deepEqual(rl.plugins(), [
      {
        name: "inspector",
        version: "1.2.3",
        actions: ["echo"],
        connectionConfigSchema: {
          token: { type: "string", required: true, description: "API token" },
        },
        sourceInfo: {
          path: join(pluginsDir, "inspector.ts"),
          source: pluginsDir,
          origin: "local",
          scope: "project",
          owner: "local",
        },
      },
    ]);

    const listed = await rl.execute(`return actions.list("inspector")`);
    assert.equal(listed.error, undefined, listed.error);
    assert.deepEqual(listed.result, ["inspector.echo"]);

    const described = await rl.execute(
      `return actions.describe("inspector.echo")`,
    );
    assert.equal(described.error, undefined, described.error);
    assert.deepEqual(
      (described.result as { inputs: Record<string, unknown> }).inputs,
      {
        message: {
          type: "string",
          required: true,
          description: "Message to echo",
        },
        loud: {
          type: "boolean",
          required: false,
          description: "Uppercase output",
        },
      },
    );

    const check = await rl.execute(
      `return actions.check("inspector.echo", { message: "hello", loud: true })`,
    );
    assert.equal(check.error, undefined, check.error);
    assert.equal((check.result as { ok: boolean }).ok, true);

    const executed = await rl.execute(
      `return await inspector.echo({ message: "hello", loud: true })`,
    );
    assert.equal(executed.error, undefined, executed.error);
    assert.deepEqual(executed.result, {
      message: "HELLO",
      connection: {
        name: "inspector",
        plugin: "inspector",
        config: { token: "secret-token", region: "iad" },
      },
    });
  });

  it("lets a custom plugin declare its credential with the public kit and sign through it", async () => {
    writeConfig([
      { name: "ledger", plugin: "ledger", config: { apiKey: "sk-ledger" } },
    ]);
    // Imports the kit from "@shiftlabs/codemode" exactly as a workspace plugin outside
    // the package tree does: through the loader's alias, no node_modules.
    writeFileSync(
      join(pluginsDir, "ledger.ts"),
      `import { credentialJson, pathSegment, staticCredential } from "@shiftlabs/codemode";

const credential = staticCredential({
  id: "ledger",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: { api: { baseUrl: "https://ledger.example/v1/", methods: ["GET"] } },
});

export default function ledger(api) {
  api.setName("ledger");
  api.setCredential(credential);
  api.registerAction("entry.get", {
    access: "read",
    execute(input, ctx) {
      return credentialJson(ctx, credential, "ledger", {
        target: "api",
        path: \`entries/\${pathSegment(input.id)}\`,
      });
    },
  });
}
`,
    );
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const originalFetch = globalThis.fetch;
    stubFetch(async (url, init) => {
      seen.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ id: "e 1", amount: 7 });
    });
    try {
      const rl = await Codemode.fromProject(tempDir, isolated());
      assert.ok(rl);
      const signed = await rl.execute(
        `return await ledger.entry.get({ id: "e 1" })`,
      );
      assert.equal(signed.error, undefined, signed.error);
      assert.deepEqual(signed.result, { id: "e 1", amount: 7 });
      assert.deepEqual(seen, [
        {
          url: "https://ledger.example/v1/entries/e%201",
          authorization: "Bearer sk-ledger",
        },
      ]);

      const traversal = await rl.execute(
        `return await ledger.entry.get({ id: "../admin" })`,
      );
      assert.match(traversal.error ?? "", /outside the approved policy/);
      assert.equal(seen.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads supported export shapes and package entrypoints", async () => {
    const defaultFn = join(tempDir, "defaultFn.js");
    writeFileSync(
      defaultFn,
      `export default function defaultFn(api) {
        api.setName("defaultFn");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    const objectExport = join(tempDir, "objectExport.js");
    writeFileSync(
      objectExport,
      `export default {
        name: "objectExport",
        version: "2.0.0",
        actions: [{ name: "ping", execute: () => "pong" }],
      };`,
    );

    const commonJs = join(tempDir, "commonjs.cjs");
    writeFileSync(
      commonJs,
      `module.exports = {
        name: "commonJsPlugin",
        version: "3.0.0",
        actions: [{ name: "ping", execute: () => "pong" }],
      };`,
    );

    const packageDir = join(pluginsDir, "packagePlugin");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ main: "dist/plugin.js" }),
    );
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(
      join(packageDir, "dist", "plugin.js"),
      `export default function packagePlugin(api) {
        api.setName("packagePlugin");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    assert.equal((await loadPluginFromPath(defaultFn)).name, "defaultFn");
    assert.equal((await loadPluginFromPath(objectExport)).name, "objectExport");
    assert.equal((await loadPluginFromPath(commonJs)).name, "commonJsPlugin");
    assert.equal((await loadPluginFromPath(packageDir)).name, "packagePlugin");

    writeConfig([]);
    const discovered = await discoverPlugins(codemodeDir, isolated());
    assert.ok(discovered.some((p) => p.name === "packagePlugin"));
  });

  it("discovers every conventional project-local entrypoint layout", async () => {
    writeConfig([]);
    const layouts = [
      ["rootTs", "index.ts"],
      ["rootJs", "index.js"],
      ["srcTs", join("src", "index.ts")],
      ["srcJs", join("src", "index.js")],
    ] as const;

    for (const [name, entry] of layouts) {
      const dir = join(pluginsDir, name);
      mkdirSync(join(dir, entry, ".."), { recursive: true });
      writeFileSync(
        join(dir, entry),
        `export default function ${name}(api) {
          api.setName("${name}");
          api.registerAction("ping", { execute: () => "${name}" });
        }`,
      );
    }

    const plugins = await discoverPlugins(codemodeDir, isolated());
    assert.deepEqual(
      plugins.map((p) => p.name).sort(),
      layouts.map(([name]) => name).sort(),
    );
  });

  it("loads valid plugins.json paths relative to the project .codemode directory", async () => {
    writeConfig([]);
    const toolsDir = join(codemodeDir, "tools");
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(
      join(toolsDir, "configured.js"),
      `export default function configured(api) {
        api.setName("configured");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(
      join(toolsDir, "configuredString.js"),
      `export default function configuredString(api) {
        api.setName("configuredString");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(
      join(codemodeDir, "plugins.json"),
      JSON.stringify({
        plugins: [
          { path: "./tools/configured.js" },
          "./tools/configuredString.js",
        ],
      }),
    );

    const plugins = await discoverPlugins(codemodeDir, isolated());
    assert.ok(plugins.some((p) => p.name === "configured"));
    assert.ok(plugins.some((p) => p.name === "configuredString"));
  });

  it("reports invalid plugins.json shapes and keeps valid entries", async () => {
    writeConfig([]);
    const good = join(codemodeDir, "good.js");
    writeFileSync(
      good,
      `export default function configuredGood(api) {
        api.setName("configuredGood");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(
      join(codemodeDir, "plugins.json"),
      JSON.stringify({
        plugins: [{ path: "./good.js" }, {}, 42, { path: "" }],
      }),
    );

    const stderr = captureStderr();
    try {
      const plugins = await discoverPlugins(codemodeDir, isolated());
      assert.ok(plugins.some((p) => p.name === "configuredGood"));
    } finally {
      stderr.restore();
    }
    assert.match(stderr.lines.join("\n"), /Invalid plugin entry/);
  });

  it("loads package.json codemode.plugins entries and keeps healthy siblings when one fails", async () => {
    writeConfig([]);
    const pkgDir = join(pluginsDir, "suite");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ codemode: { plugins: ["good.js", "bad.js"] } }),
    );
    writeFileSync(
      join(pkgDir, "good.js"),
      `export default function good(api) {
        api.setName("good");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(join(pkgDir, "bad.js"), `export default 1;`);

    const stderr = captureStderr();
    try {
      const plugins = await discoverPlugins(codemodeDir, isolated());
      assert.ok(plugins.some((p) => p.name === "good"));
    } finally {
      stderr.restore();
    }
    assert.match(stderr.lines.join("\n"), /bad\.js.*Invalid plugin export/);
  });

  it("applies env overrides and surfaces custom plugin validation and execution errors", async () => {
    process.env.CUSTOM_PLUGIN_TOKEN = "from-env";
    writeConfig([
      {
        name: "typed",
        plugin: "typed",
        config: {},
      },
    ]);
    writeFileSync(
      join(pluginsDir, "typed.ts"),
      `export default function typed(api) {
  api.setName("typed");
  api.setConnectionSchema({
    type: "object",
    properties: { token: { type: "string", env: "CUSTOM_PLUGIN_TOKEN" } },
    required: ["token"],
  });
  api.registerAction("strict", {
    inputSchema: {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
      additionalProperties: false,
    },
    execute(input, ctx) {
      return { input, token: ctx.connection.config.token };
    },
  });
  api.registerAction("explode", {
    execute() { throw new Error("custom plugin exploded"); },
  });
}
`,
    );

    const rl = await Codemode.fromProject(tempDir, isolated());
    assert.ok(rl);

    const valid = await rl.execute(`return await typed.strict({ count: 2 })`);
    assert.equal(valid.error, undefined, valid.error);
    assert.deepEqual(valid.result, { input: { count: 2 }, token: "from-env" });

    const invalid = await rl.execute(
      `return await typed.strict({ count: "two" })`,
    );
    assert.match(invalid.error ?? "", /typed\.strict/);
    assert.match(invalid.error ?? "", /count/);

    const exploded = await rl.execute(`return await typed.explode()`);
    assert.match(exploded.error ?? "", /custom plugin exploded/);
  });

  it("reports invalid package.json while preserving sibling plugins", async () => {
    writeConfig([]);
    const brokenDir = join(pluginsDir, "brokenPackage");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, "package.json"), `{ nope`);
    const healthyDir = join(pluginsDir, "healthyPackage");
    mkdirSync(healthyDir, { recursive: true });
    writeFileSync(
      join(healthyDir, "index.js"),
      `export default function healthyPackage(api) {
        api.setName("healthyPackage");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    const stderr = captureStderr();
    try {
      const plugins = await discoverPlugins(codemodeDir, isolated());
      assert.ok(plugins.some((p) => p.name === "healthyPackage"));
    } finally {
      stderr.restore();
    }
    const output = stderr.lines.join("\n");
    assert.match(output, /Failed to parse .*package\.json/);
    assert.match(output, /No entry point found/);
  });

  it("reports duplicate custom plugin names from the same project", async () => {
    writeConfig([]);
    for (const filename of ["first.js", "second.js"]) {
      writeFileSync(
        join(pluginsDir, filename),
        `export default function dupe(api) {
          api.setName("dupe");
          api.registerAction("${filename.replace(".js", "")}", { execute: () => null });
        }`,
      );
    }

    const stderr = captureStderr();
    try {
      const plugins = await discoverPlugins(codemodeDir, isolated());
      assert.equal(plugins.filter((p) => p.name === "dupe").length, 1);
    } finally {
      stderr.restore();
    }
    assert.match(stderr.lines.join("\n"), /Skipping duplicate plugin "dupe"/);
  });

  it("keeps healthy plugins available while reporting malformed plugins, registration errors, missing entrypoints, and invalid plugins.json", async () => {
    writeConfig([]);
    writeFileSync(
      join(pluginsDir, "healthy.js"),
      `export default function healthy(api) {
        api.setName("healthy");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    writeFileSync(join(pluginsDir, "malformed.js"), `export default 42;`);
    writeFileSync(
      join(pluginsDir, "badName.js"),
      `export default function badName(api) { api.setName("bad-name"); }`,
    );
    writeFileSync(
      join(pluginsDir, "registrationError.js"),
      `export default function registrationError(api) {
        api.setName("registrationError");
        throw new Error("boom while registering actions");
      }`,
    );
    mkdirSync(join(pluginsDir, "emptyPlugin"), { recursive: true });
    writeFileSync(join(codemodeDir, "plugins.json"), `{ "plugins": [`);
    writeFileSync(
      join(builtinDir, "bundled.js"),
      `export default function bundled(api) {
        api.setName("bundled");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );

    const stderr = captureStderr();
    try {
      const plugins = await discoverPlugins(codemodeDir, isolated());
      assert.deepEqual(
        plugins.map((p) => [p.name, p.sourceInfo?.origin]),
        [
          ["healthy", "local"],
          ["bundled", "builtin"],
        ],
      );
    } finally {
      stderr.restore();
    }

    const output = stderr.lines.join("\n");
    assert.match(
      output,
      /Failed to load plugin from .*malformed\.js.*Invalid plugin export/,
    );
    assert.match(
      output,
      /Failed to load plugin from .*badName\.js.*Invalid plugin name/,
    );
    assert.match(
      output,
      /Failed to load plugin from .*registrationError\.js.*boom while registering actions/,
    );
    assert.match(
      output,
      /Failed to load plugin from .*emptyPlugin.*No entry point found/,
    );
    assert.match(output, /Failed to parse .*plugins\.json/);
  });

  it("gives a bundled plugin's name to a local plugin only when it is listed as replaceable", async () => {
    writeConfig([]);
    const source = (action: string) =>
      `export default function mail(api) {
        api.setName("mail");
        api.registerAction("${action}", { execute: () => "${action}" });
      }`;
    writeFileSync(join(pluginsDir, "mail.js"), source("local"));
    writeFileSync(join(builtinDir, "mail.js"), source("bundled"));

    const stderr = captureStderr();
    try {
      const kept = await discoverPlugins(codemodeDir, isolated());
      assert.deepEqual(
        kept.map((p) => [p.name, p.sourceInfo?.origin, p.actions[0].name]),
        [["mail", "builtin", "bundled"]],
      );
    } finally {
      stderr.restore();
    }
    assert.match(
      stderr.lines.join("\n"),
      /Plugin "mail" from .*plugins has the name of a bundled plugin and was not loaded.*replaceableBuiltins/,
    );

    const quiet = captureStderr();
    try {
      const replaced = await discoverPlugins(codemodeDir, {
        ...isolated(),
        replaceableBuiltins: ["mail"],
      });
      assert.deepEqual(
        replaced.map((p) => [p.name, p.sourceInfo?.origin, p.actions[0].name]),
        [["mail", "local", "local"]],
      );
    } finally {
      quiet.restore();
    }
    assert.deepEqual(quiet.lines, []);
  });

  it("refuses a plugin whose name cannot be a variable, and runs the rest", async () => {
    writeConfig([]);
    writeFileSync(
      join(pluginsDir, "healthy.js"),
      `export default function healthy(api) {
        api.setName("healthy");
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    // Named after its file, which is no identifier.
    writeFileSync(
      join(pluginsDir, "my-tool.js"),
      `export default function (api) {
        api.registerAction("ping", { execute: () => "pong" });
      }`,
    );
    // An object export is held to the same rule as setName.
    for (const name of ["console", "class", "has space"])
      writeFileSync(
        join(pluginsDir, `object${name.length}.js`),
        `export default { name: ${JSON.stringify(name)}, version: "1.0.0", actions: [{ name: "ping", execute: () => "pong" }] };`,
      );

    const stderr = captureStderr();
    let rl: Codemode | null;
    try {
      rl = await Codemode.fromProject(tempDir, isolated());
    } finally {
      stderr.restore();
    }
    assert.deepEqual(
      rl?.plugins().map((p) => p.name),
      ["healthy"],
    );
    const output = stderr.lines.join("\n");
    for (const name of ["my-tool", "console", "class", "has space"])
      assert.match(output, new RegExp(`Invalid plugin name "${name}"`));
    const run = await rl?.execute("return await healthy.ping()");
    assert.equal(run?.error, undefined, run?.error);
    assert.equal(run?.result, "pong");
    rl?.dispose();
  });

  it("prefers src/index over index in a plugin folder", async () => {
    writeConfig([]);
    const dir = join(pluginsDir, "both");
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [file, action] of [
      ["index.js", "root"],
      [join("src", "index.js"), "src"],
    ])
      writeFileSync(
        join(dir, file),
        `export default function both(api) {
          api.setName("both");
          api.registerAction("${action}", { execute: () => null });
        }`,
      );
    const [plugin] = await discoverPlugins(codemodeDir, isolated());
    assert.deepEqual(
      plugin.actions.map((a) => a.name),
      ["src"],
    );
  });

  it("drops a sourceInfo a plugin module declares for itself", async () => {
    writeConfig([]);
    writeFileSync(
      join(pluginsDir, "forged.js"),
      `export default {
        name: "forged",
        version: "1.0.0",
        actions: [{ name: "ping", execute: () => "pong" }],
        sourceInfo: { path: "x", source: "builtin", origin: "builtin", owner: "builtin" },
      };`,
    );
    const direct = await loadPluginFromPath(join(pluginsDir, "forged.js"));
    assert.equal(direct.sourceInfo, undefined);
    const [plugin] = await discoverPlugins(codemodeDir, isolated());
    assert.equal(plugin.sourceInfo?.owner, "local");
    assert.equal(plugin.sourceInfo?.scope, "project");
    assert.match(plugin.sourceInfo?.path ?? "", /forged\.js$/);
  });
});
