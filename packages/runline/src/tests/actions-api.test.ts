import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";

function makeGithub() {
  const { api, resolve } = createPluginAPI("github");
  api.setName("github");
  api.setVersion("1.0.0");
  api.registerAction("issue.create", {
    description: "Create an issue",
    inputSchema: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      title: { type: "string", required: true },
      body: { type: "string" },
      labels: { type: "array" },
    },
    execute: async (input) => ({ created: true, input }),
  });
  api.registerAction("issue.list", {
    description: "List issues",
    inputSchema: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
    },
    execute: async () => [],
  });
  api.registerAction("user.listRepos", {
    description: "List repos for a user",
    inputSchema: { username: { type: "string", required: true } },
    execute: async () => [],
  });
  return resolve();
}

function makePipedrive() {
  const { api, resolve } = createPluginAPI("pipedrive");
  api.setName("pipedrive");
  api.setVersion("1.0.0");
  api.registerAction("deal.list", {
    description: "List deals",
    execute: async () => [],
  });
  return resolve();
}

function makeNoSchema() {
  const { api, resolve } = createPluginAPI("plain");
  api.setName("plain");
  api.setVersion("1.0.0");
  api.registerAction("ping", {
    description: "No schema",
    execute: () => "pong",
  });
  return resolve();
}

function createEngine() {
  const registry = new PluginRegistry();
  registry.register(makeGithub());
  registry.register(makePipedrive());
  registry.register(makeNoSchema());
  return new ExecutionEngine(registry, { ...DEFAULT_CONFIG, timeoutMs: 5000 });
}

async function run<T = unknown>(code: string): Promise<T> {
  const engine = createEngine();
  const r = await engine.execute(code);
  assert.equal(r.error, undefined, r.error);
  return r.result as T;
}

describe("actions.list", () => {
  it("returns every plugin.action path when called with no args", async () => {
    const result = await run<string[]>("return actions.list()");
    assert.deepEqual(
      [...result].sort(),
      [
        "github.issue.create",
        "github.issue.list",
        "github.user.listRepos",
        "pipedrive.deal.list",
        "plain.ping",
      ].sort(),
    );
  });

  it("filters by plugin prefix", async () => {
    const result = await run<string[]>('return actions.list("github")');
    assert.deepEqual([...result].sort(), [
      "github.issue.create",
      "github.issue.list",
      "github.user.listRepos",
    ]);
  });

  it("returns empty array for unknown plugin", async () => {
    const result = await run<string[]>('return actions.list("unknown")');
    assert.deepEqual(result, []);
  });
});

describe("actions.find", () => {
  it("ranks exact-ish matches first", async () => {
    const result = await run<Array<{ path: string }>>(
      'return actions.find("create issue")',
    );
    assert.ok(result.length > 0);
    assert.equal(result[0].path, "github.issue.create");
  });

  it("matches by description", async () => {
    const result = await run<Array<{ path: string }>>(
      'return actions.find("repos")',
    );
    assert.ok(result.some((r) => r.path === "github.user.listRepos"));
  });

  it("tolerates typos via fuzzy matching", async () => {
    const result = await run<Array<{ path: string }>>(
      'return actions.find("issu")',
    );
    assert.ok(result.some((r) => r.path.startsWith("github.issue.")));
  });

  it("returns empty array for empty query", async () => {
    const r1 = await run<unknown[]>('return actions.find("")');
    const r2 = await run<unknown[]>("return actions.find()");
    assert.deepEqual(r1, []);
    assert.deepEqual(r2, []);
  });

  it("respects limit argument", async () => {
    const result = await run<unknown[]>('return actions.find("issue", 1)');
    assert.equal(result.length, 1);
  });

  it("each result has path, optional description, and score", async () => {
    const result = await run<
      Array<{ path: string; description?: string; score: number }>
    >('return actions.find("create")');
    assert.ok(result.length > 0);
    for (const r of result) {
      assert.equal(typeof r.path, "string");
      assert.equal(typeof r.score, "number");
    }
  });
});

describe("actions.describe", () => {
  it("returns full metadata for a known action", async () => {
    const result = await run<{
      path: string;
      plugin: string;
      action: string;
      description?: string;
      signature: string;
      inputs: Record<string, { type: string; required: boolean }>;
    }>('return actions.describe("github.issue.create")');
    assert.equal(result.path, "github.issue.create");
    assert.equal(result.plugin, "github");
    assert.equal(result.action, "issue.create");
    assert.equal(result.description, "Create an issue");
    assert.match(result.signature, /^github\.issue\.create\({.*}\)$/);
    assert.equal(result.inputs.owner.required, true);
    assert.equal(result.inputs.body.required, false);
  });

  it("signature reflects required vs optional fields", async () => {
    const result = await run<{ signature: string }>(
      'return actions.describe("github.issue.create")',
    );
    assert.match(result.signature, /owner: string/);
    assert.match(result.signature, /body\?: string/);
  });

  it("handles actions with no input schema", async () => {
    const result = await run<{ signature: string; inputs: object }>(
      'return actions.describe("plain.ping")',
    );
    assert.equal(result.signature, "plain.ping()");
    assert.deepEqual(result.inputs, {});
  });

  it("throws with did-you-mean suggestions on unknown path", async () => {
    const code = `try { actions.describe("github.issue.craete"); return null; } catch (e) { return e.message; }`;
    const msg = await run<string>(code);
    assert.match(msg, /Unknown action: github\.issue\.craete/);
    assert.match(msg, /Did you mean.*github\.issue\.create/);
  });
});

describe("actions.check", () => {
  it("ok=true for a fully-specified valid call", async () => {
    const result = await run<{ ok: boolean }>(
      `return actions.check("github.issue.create", { owner: "a", repo: "b", title: "c" })`,
    );
    assert.equal(result.ok, true);
  });

  it("reports missing required fields", async () => {
    const result = await run<{ ok: boolean; missing: string[] }>(
      `return actions.check("github.issue.create", { owner: "a" })`,
    );
    assert.equal(result.ok, false);
    assert.deepEqual([...result.missing].sort(), ["repo", "title"]);
  });

  it("reports unknown fields", async () => {
    const result = await run<{ ok: boolean; unknown: string[] }>(
      `return actions.check("github.issue.create", { owner: "a", repo: "b", title: "c", weird: 1 })`,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.unknown, ["weird"]);
  });

  it("reports type errors", async () => {
    const result = await run<{
      ok: boolean;
      typeErrors: Array<{ field: string; expected: string; actual: string }>;
    }>(
      `return actions.check("github.issue.create", { owner: 1, repo: "b", title: "c" })`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.typeErrors.length, 1);
    assert.equal(result.typeErrors[0].field, "owner");
    assert.equal(result.typeErrors[0].expected, "string");
    assert.equal(result.typeErrors[0].actual, "number");
  });

  it("recognizes arrays via Array.isArray", async () => {
    const result = await run<{ ok: boolean; typeErrors: unknown[] }>(
      `return actions.check("github.issue.create", { owner: "a", repo: "b", title: "c", labels: ["bug"] })`,
    );
    assert.equal(result.ok, true);
  });

  it("returns suggestions for unknown action", async () => {
    const result = await run<{
      ok: boolean;
      error: string;
      suggestions: string[];
    }>(`return actions.check("github.issue.craete", {})`);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown action/);
    assert.ok(result.suggestions.includes("github.issue.create"));
  });

  it("does not actually invoke the action", async () => {
    // If check called execute, it would throw because owner/repo/title missing
    // and the underlying handler would still try to run. Instead it returns
    // a structured report.
    const result = await run<{ ok: boolean }>(
      `return actions.check("github.issue.create", {})`,
    );
    assert.equal(result.ok, false);
  });
});

describe("actions proxy fallback", () => {
  it("still calls actions.<plugin>.<action>(...) like before", async () => {
    const result = await run<unknown>(
      `return await actions.github.issue.create({ owner: "a", repo: "b", title: "c" })`,
    );
    assert.deepEqual(result, {
      created: true,
      input: { owner: "a", repo: "b", title: "c" },
    });
  });

  it("plugin globals coexist with actions.* helpers", async () => {
    const result = await run<unknown>(
      `const list = actions.list("github"); const r = await github.issue.list({ owner: "a", repo: "b" }); return { count: list.length, r };`,
    );
    assert.deepEqual(result, { count: 3, r: [] });
  });
});
