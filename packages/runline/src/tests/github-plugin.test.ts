import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import github from "../../../runline-plugins/github/src/index.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ExecutionEngine } from "../core/engine.js";
import { createPluginAPI } from "../plugin/api.js";
import { PluginRegistry } from "../plugin/registry.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeGithub(): PluginDef {
  const { api, resolve } = createPluginAPI("github");
  github(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected github.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "github",
      plugin: "github",
      config: { token: "gh_test", baseUrl: "https://api.github.test" },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    async updateConnection() {},
  };
}

function mockJsonFetch(assertRequest: (url: URL, init?: RequestInit) => void) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assertRequest(url, init);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("github plugin commit and branch actions", () => {
  it("registers commit.list, commit.get, and branch.get", () => {
    const plugin = makeGithub();
    assert.ok(plugin.actions.some((a) => a.name === "commit.list"));
    assert.ok(plugin.actions.some((a) => a.name === "commit.get"));
    assert.ok(plugin.actions.some((a) => a.name === "branch.get"));
  });

  it("commit.list calls GitHub's list commits endpoint with documented query params", async () => {
    const action = getAction(makeGithub(), "commit.list");

    mockJsonFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(url.pathname, "/repos/octo/hello/commits");
      assert.equal(url.searchParams.get("sha"), "main");
      assert.equal(url.searchParams.get("path"), "src/index.ts");
      assert.equal(url.searchParams.get("author"), "octocat");
      assert.equal(url.searchParams.get("since"), "2026-01-01T00:00:00Z");
      assert.equal(url.searchParams.get("until"), "2026-01-31T00:00:00Z");
      assert.equal(url.searchParams.get("per_page"), "25");
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(
        init?.headers?.["Authorization" as keyof HeadersInit],
        "Bearer gh_test",
      );
    });

    const result = await action.execute(
      {
        owner: "octo",
        repo: "hello",
        sha: "main",
        path: "src/index.ts",
        author: "octocat",
        since: "2026-01-01T00:00:00Z",
        until: "2026-01-31T00:00:00Z",
        perPage: 25,
        page: 2,
      },
      ctx(),
    );

    assert.deepEqual(result, { ok: true });
  });

  it("commit.get calls GitHub's get commit endpoint", async () => {
    const action = getAction(makeGithub(), "commit.get");

    mockJsonFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(
        url.pathname,
        "/repos/octo/hello/commits/feature%2Fread-api",
      );
    });

    const result = await action.execute(
      { owner: "octo", repo: "hello", ref: "feature/read-api" },
      ctx(),
    );

    assert.deepEqual(result, { ok: true });
  });

  it("branch.get calls GitHub's get branch endpoint", async () => {
    const action = getAction(makeGithub(), "branch.get");

    mockJsonFetch((url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(
        url.pathname,
        "/repos/octo/hello/branches/feature%2Fread-api",
      );
    });

    const result = await action.execute(
      { owner: "octo", repo: "hello", branch: "feature/read-api" },
      ctx(),
    );

    assert.deepEqual(result, { ok: true });
  });

  it("actions.find can discover latest commit actions", async () => {
    const registry = new PluginRegistry();
    registry.register(makeGithub());
    const engine = new ExecutionEngine(registry, {
      ...DEFAULT_CONFIG,
      timeoutMs: 5000,
    });

    const result = await engine.execute('return actions.find("latest commit")');
    assert.equal(result.error, undefined, result.error);
    const hits = result.result as Array<{ path: string }>;
    assert.ok(hits.some((hit) => hit.path === "github.commit.list"));
  });
});
