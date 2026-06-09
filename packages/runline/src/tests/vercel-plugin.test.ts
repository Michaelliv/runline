import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import vercel from "../../../runline-plugins/vercel/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const VERCEL_ACTIONS = [
  "deployment.cancel",
  "deployment.get",
  "deployment.list",
  "deployment.logs",
  "deployment.promote",
  "deployment.runtimeLogs",
  "env.delete",
  "env.get",
  "env.list",
  "env.set",
  "project.domains",
  "project.get",
  "project.list",
  "whoami",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeVercel(): PluginDef {
  const { api, resolve } = createPluginAPI("vercel");
  vercel(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected vercel.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "vercel",
      plugin: "vercel",
      config: { token: "vcp_test", ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

function mockVercel(
  assertRequest: (request: {
    url: URL;
    init?: RequestInit;
    body?: unknown;
  }) => unknown,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.vercel.com");
    assert.equal(
      init?.headers?.["Authorization" as keyof HeadersInit],
      "Bearer vcp_test",
    );
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const data = assertRequest({ url, init, body });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("vercel plugin action surface", () => {
  it("registers the expected public actions", () => {
    const plugin = makeVercel();
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...VERCEL_ACTIONS,
    ]);
  });
});

describe("vercel plugin REST actions", () => {
  it("adds auth and team scope to project.list", async () => {
    const action = getAction(makeVercel(), "project.list");

    mockVercel(({ url, init }) => {
      assert.equal(url.pathname, "/v10/projects");
      assert.equal(url.searchParams.get("teamId"), "team_123");
      assert.equal(url.searchParams.get("limit"), "2");
      assert.equal(url.searchParams.get("search"), "docs");
      assert.equal(init?.method, "GET");
      return { projects: [{ id: "prj_1", name: "docs" }] };
    });

    assert.deepEqual(
      await action.execute(
        { limit: 2, search: "docs" },
        ctx({ teamId: "team_123" }),
      ),
      {
        projects: [{ id: "prj_1", name: "docs" }],
      },
    );
  });

  it("gets deployments and build logs", async () => {
    const get = getAction(makeVercel(), "deployment.get");
    const logs = getAction(makeVercel(), "deployment.logs");
    let count = 0;

    mockVercel(({ url }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v13/deployments/dpl_123");
        return { id: "dpl_123", readyState: "READY" };
      }
      assert.equal(url.pathname, "/v3/deployments/dpl_123/events");
      assert.equal(url.searchParams.get("builds"), "1");
      assert.equal(url.searchParams.get("limit"), "10");
      return [{ type: "stdout", payload: { text: "built" } }];
    });

    assert.deepEqual(await get.execute({ id: "dpl_123" }, ctx()), {
      id: "dpl_123",
      readyState: "READY",
    });
    assert.deepEqual(
      await logs.execute({ idOrUrl: "dpl_123", builds: 1, limit: 10 }, ctx()),
      [{ type: "stdout", payload: { text: "built" } }],
    );
  });

  it("gets runtime logs with project and deployment ids", async () => {
    const action = getAction(makeVercel(), "deployment.runtimeLogs");

    mockVercel(({ url }) => {
      assert.equal(
        url.pathname,
        "/v1/projects/prj_1/deployments/dpl_1/runtime-logs",
      );
      assert.equal(url.searchParams.get("since"), "100");
      return [{ level: "info", message: "ok" }];
    });

    assert.deepEqual(
      await action.execute(
        { projectId: "prj_1", deploymentId: "dpl_1", since: 100 },
        ctx(),
      ),
      [{ level: "info", message: "ok" }],
    );
  });

  it("validates the token with whoami and supports deployment cancel/promote", async () => {
    const whoami = getAction(makeVercel(), "whoami");
    const cancel = getAction(makeVercel(), "deployment.cancel");
    const promote = getAction(makeVercel(), "deployment.promote");
    let count = 0;

    mockVercel(({ url, init }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v2/user");
        return { user: { id: "user_1" } };
      }
      if (count === 2) {
        assert.equal(url.pathname, "/v12/deployments/dpl_1/cancel");
        assert.equal(init?.method, "PATCH");
        return { canceled: true };
      }
      assert.equal(url.pathname, "/v10/projects/prj_1/promote/dpl_1");
      assert.equal(init?.method, "POST");
      return { promoted: true };
    });

    assert.deepEqual(await whoami.execute({}, ctx()), {
      user: { id: "user_1" },
    });
    assert.deepEqual(await cancel.execute({ id: "dpl_1" }, ctx()), {
      canceled: true,
    });
    assert.deepEqual(
      await promote.execute(
        { projectId: "prj_1", deploymentId: "dpl_1" },
        ctx(),
      ),
      { promoted: true },
    );
  });

  it("manages project env vars through Vercel env endpoints", async () => {
    const list = getAction(makeVercel(), "env.list");
    const set = getAction(makeVercel(), "env.set");
    const del = getAction(makeVercel(), "env.delete");
    let count = 0;

    mockVercel(({ url, init, body }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v10/projects/my-app/env");
        assert.equal(url.searchParams.get("target"), "production");
        return { envs: [] };
      }
      if (count === 2) {
        assert.equal(url.pathname, "/v10/projects/my-app/env");
        assert.equal(init?.method, "POST");
        assert.deepEqual(body, {
          key: "API_URL",
          value: "https://example.test",
          type: "encrypted",
          target: ["production"],
        });
        return { created: [{ id: "env_1" }] };
      }
      if (count === 3) {
        assert.equal(url.pathname, "/v9/projects/my-app/env/env_1");
        assert.equal(init?.method, "PATCH");
        assert.deepEqual(body, { value: "updated" });
        return { id: "env_1" };
      }
      assert.equal(url.pathname, "/v9/projects/my-app/env/env_1");
      assert.equal(init?.method, "DELETE");
      return { removed: true };
    });

    await list.execute(
      { projectIdOrName: "my-app", target: "production" },
      ctx(),
    );
    await set.execute(
      {
        projectIdOrName: "my-app",
        key: "API_URL",
        value: "https://example.test",
        type: "encrypted",
        target: "production",
      },
      ctx(),
    );
    await set.execute(
      { projectIdOrName: "my-app", id: "env_1", value: "updated" },
      ctx(),
    );
    assert.deepEqual(
      await del.execute({ projectIdOrName: "my-app", id: "env_1" }, ctx()),
      { removed: true },
    );
  });

  it("throws useful Vercel API errors", async () => {
    const action = getAction(makeVercel(), "project.get");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "nope" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await assert.rejects(
      action.execute({ id: "missing" }, ctx()),
      /Vercel API error 403/,
    );
  });
});
