import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPluginAPI,
  isPluginFunction,
  resolvePluginExport,
} from "../plugin/api.js";

describe("createPluginAPI", () => {
  it("creates a plugin with name, version, and actions", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("myPlugin");
    api.setVersion("2.0.0");
    api.registerAction("doThing", {
      description: "Does a thing",
      inputSchema: { x: { type: "number", required: true } },
      execute: (input) => input,
    });

    const plugin = resolve();
    assert.equal(plugin.name, "myPlugin");
    assert.equal(plugin.version, "2.0.0");
    assert.equal(plugin.actions.length, 1);
    assert.equal(plugin.actions[0].name, "doThing");
    assert.equal(plugin.actions[0].description, "Does a thing");
  });

  it("defaults version to 0.0.0", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("minimal");
    const plugin = resolve();
    assert.equal(plugin.version, "0.0.0");
  });

  it("rejects invalid plugin names", () => {
    const { api } = createPluginAPI("test");
    assert.throws(() => api.setName("has-hyphen"), /valid JS identifier/);
    assert.throws(() => api.setName("has.dot"), /valid JS identifier/);
    assert.throws(() => api.setName("123start"), /valid JS identifier/);
  });

  it("accepts valid plugin names", () => {
    const { api } = createPluginAPI("test");
    api.setName("camelCase");
    api.setName("_underscored");
    api.setName("$dollarSign");
    api.setName("PascalCase");
  });

  it("sets connection schema", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("withAuth");
    api.setConnectionSchema({
      apiKey: { type: "string", required: true, env: "MY_API_KEY" },
      baseUrl: { type: "string", required: false },
    });

    const plugin = resolve();
    assert.ok(plugin.connectionConfigSchema);
    assert.equal(plugin.connectionConfigSchema.apiKey.type, "string");
    assert.equal(plugin.connectionConfigSchema.apiKey.env, "MY_API_KEY");
  });

  it("records OAuth config when setOAuth is called", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("oauthy");
    api.setOAuth({
      authUrl: "https://example.com/authorize",
      tokenUrl: "https://example.com/token",
      scopes: ["a", "b"],
      authParams: { access_type: "offline" },
    });

    const plugin = resolve();
    assert.ok(plugin.oauth);
    assert.equal(plugin.oauth.authUrl, "https://example.com/authorize");
    assert.equal(plugin.oauth.tokenUrl, "https://example.com/token");
    assert.deepEqual(plugin.oauth.scopes, ["a", "b"]);
    assert.deepEqual(plugin.oauth.authParams, { access_type: "offline" });
  });

  it("omits oauth when setOAuth is never called", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("noauth");
    const plugin = resolve();
    assert.equal(plugin.oauth, undefined);
  });

  it("registers init hooks", () => {
    const calls: unknown[] = [];
    const { api, resolve } = createPluginAPI("test");
    api.setName("hooked");
    api.onInit((config) => calls.push(config));

    const plugin = resolve();
    assert.ok(plugin.initHooks);
    assert.equal(plugin.initHooks.length, 1);
  });

  it("registers multiple actions", () => {
    const { api, resolve } = createPluginAPI("test");
    api.setName("multi");
    api.registerAction("a", { execute: () => "a" });
    api.registerAction("b", { execute: () => "b" });
    api.registerAction("c.nested", { execute: () => "c" });

    const plugin = resolve();
    assert.equal(plugin.actions.length, 3);
    assert.deepEqual(
      plugin.actions.map((a) => a.name),
      ["a", "b", "c.nested"],
    );
  });
});

describe("resolvePluginExport", () => {
  it("resolves a plugin function", () => {
    const plugin = resolvePluginExport((api) => {
      api.setName("fromFn");
      api.registerAction("ping", { execute: () => "pong" });
    }, "fallback");

    assert.equal(plugin.name, "fromFn");
    assert.equal(plugin.actions.length, 1);
  });

  it("resolves a plain PluginDef object", () => {
    const def = {
      name: "plain",
      version: "1.0.0",
      actions: [{ name: "x", execute: () => null }],
    };
    const plugin = resolvePluginExport(def, "ignored");
    assert.equal(plugin.name, "plain");
  });

  it("throws on invalid exports", () => {
    assert.throws(
      () => resolvePluginExport("not a plugin" as any, "bad"),
      /Invalid plugin export/,
    );
    assert.throws(
      () => resolvePluginExport(42 as any, "bad"),
      /Invalid plugin export/,
    );
  });
});

describe("isPluginFunction", () => {
  it("identifies functions", () => {
    assert.ok(isPluginFunction(() => {}));
    assert.ok(!isPluginFunction({}));
    assert.ok(!isPluginFunction("string"));
    assert.ok(!isPluginFunction(null));
  });
});
