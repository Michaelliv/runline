import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import steel from "../../../runline-plugins/steel/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const STEEL_ACTIONS = [
  "browser.extract",
  "browser.run",
  "browser.scrape",
  "browser.screenshot",
  "captcha.solve",
  "captcha.solveImage",
  "captcha.status",
  "credential.create",
  "credential.delete",
  "credential.get",
  "credential.list",
  "extension.delete",
  "extension.deleteAll",
  "extension.list",
  "extension.update",
  "extension.upload",
  "file.delete",
  "file.download",
  "file.list",
  "file.upload",
  "pdf",
  "profile.create",
  "profile.get",
  "profile.list",
  "profile.update",
  "scrape",
  "screenshot",
  "session.cdpUrl",
  "session.computer",
  "session.context",
  "session.create",
  "session.events",
  "session.get",
  "session.hls",
  "session.list",
  "session.release",
  "session.releaseAll",
  "session.traces",
  "sessionFile.delete",
  "sessionFile.deleteAll",
  "sessionFile.download",
  "sessionFile.downloadArchive",
  "sessionFile.list",
  "sessionFile.upload",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeSteel(): PluginDef {
  const { api, resolve } = createPluginAPI("steel");
  steel(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected steel.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "steel",
      plugin: "steel",
      config: { apiKey: "ste_test", ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

function mockSteel(
  assertRequest: (request: {
    url: URL;
    init?: RequestInit;
    body?: unknown;
  }) => unknown,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.steel.dev");
    assert.equal(
      init?.headers?.["steel-api-key" as keyof HeadersInit],
      "ste_test",
    );
    let body: unknown;
    if (init?.body instanceof FormData) {
      body = Object.fromEntries(init.body.entries());
    } else {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    }
    const data = assertRequest({ url, init, body });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("steel plugin action surface", () => {
  it("registers the expected public actions", () => {
    const plugin = makeSteel();
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...STEEL_ACTIONS,
    ]);
  });
});

describe("steel plugin REST actions", () => {
  it("creates and releases sessions with api key auth", async () => {
    const create = getAction(makeSteel(), "session.create");
    const release = getAction(makeSteel(), "session.release");
    let count = 0;

    mockSteel(({ url, init, body }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v1/sessions");
        assert.equal(init?.method, "POST");
        assert.deepEqual(body, { solveCaptcha: true, region: "lax" });
        return {
          id: "sess_1",
          websocketUrl: "wss://connect.steel.dev?sessionId=sess_1",
        };
      }
      assert.equal(url.pathname, "/v1/sessions/sess_1/release");
      assert.equal(init?.method, "POST");
      return { released: true };
    });

    assert.deepEqual(
      await create.execute({ solveCaptcha: true, region: "lax" }, ctx()),
      {
        id: "sess_1",
        websocketUrl: "wss://connect.steel.dev?sessionId=sess_1",
      },
    );
    assert.deepEqual(await release.execute({ id: "sess_1" }, ctx()), {
      released: true,
    });
  });

  it("supports browser tools", async () => {
    const scrape = getAction(makeSteel(), "scrape");
    const screenshot = getAction(makeSteel(), "screenshot");
    let count = 0;

    mockSteel(({ url, init, body }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v1/scrape");
        assert.equal(init?.method, "POST");
        assert.deepEqual(body, {
          url: "https://example.com",
          format: ["markdown"],
          delay: 100,
        });
        return { content: { markdown: "# Example" } };
      }
      assert.equal(url.pathname, "/v1/screenshot");
      assert.deepEqual(body, { url: "https://example.com", fullPage: true });
      return { url: "https://files.steel.dev/v1/static/page.png" };
    });

    await scrape.execute(
      { url: "https://example.com", format: ["markdown"], delay: 100 },
      ctx(),
    );
    await screenshot.execute(
      { url: "https://example.com", fullPage: true },
      ctx(),
    );
  });

  it("builds CDP URLs without exposing process env", async () => {
    const action = getAction(makeSteel(), "session.cdpUrl");
    assert.deepEqual(await action.execute({ id: "sess_1" }, ctx()), {
      cdpUrl: "wss://connect.steel.dev?apiKey=ste_test&sessionId=sess_1",
    });
    assert.deepEqual(
      await action.execute(
        { id: "sess_1", websocketUrl: "wss://custom?sessionId=sess_1" },
        ctx(),
      ),
      { cdpUrl: "wss://custom?sessionId=sess_1&apiKey=ste_test" },
    );
  });

  it("manages files, credentials, profiles, extensions, captchas, and traces", async () => {
    const plugin = makeSteel();
    const actions = [
      "session.traces",
      "sessionFile.upload",
      "credential.create",
      "profile.update",
      "extension.upload",
      "captcha.solve",
    ];
    let count = 0;
    mockSteel(({ url, init, body }) => {
      count++;
      if (count === 1) {
        assert.equal(url.pathname, "/v1/sessions/sess_1/agent-traces");
        assert.equal(
          url.searchParams.get("startTime"),
          "2026-01-01T00:00:00.000Z",
        );
      }
      if (count === 2) {
        assert.equal(url.pathname, "/v1/sessions/sess_1/files");
        assert.equal(init?.method, "POST");
        assert.deepEqual(body, {
          file: "https://example.com/a.csv",
          path: "a.csv",
        });
      }
      if (count === 3) {
        assert.equal(url.pathname, "/v1/credentials");
        assert.deepEqual(body, {
          origin: "https://example.com",
          value: { username: "u", password: "p" },
        });
      }
      if (count === 4) {
        assert.equal(url.pathname, "/v1/profiles/prof_1");
        assert.equal(init?.method, "PATCH");
        assert.deepEqual(body, { userAgent: "UA" });
      }
      if (count === 5) {
        assert.equal(url.pathname, "/v1/extensions");
        assert.deepEqual(body, {
          url: "https://chromewebstore.google.com/detail/x/y",
        });
      }
      if (count === 6) {
        assert.equal(url.pathname, "/v1/sessions/sess_1/captchas/solve");
        assert.deepEqual(body, { taskId: "task_1" });
      }
      return { ok: true };
    });

    await getAction(plugin, actions[0]).execute(
      { id: "sess_1", startTime: "2026-01-01T00:00:00.000Z" },
      ctx(),
    );
    await getAction(plugin, actions[1]).execute(
      { sessionId: "sess_1", file: "https://example.com/a.csv", path: "a.csv" },
      ctx(),
    );
    await getAction(plugin, actions[2]).execute(
      {
        origin: "https://example.com",
        value: { username: "u", password: "p" },
      },
      ctx(),
    );
    await getAction(plugin, actions[3]).execute(
      { id: "prof_1", userAgent: "UA" },
      ctx(),
    );
    await getAction(plugin, actions[4]).execute(
      { url: "https://chromewebstore.google.com/detail/x/y" },
      ctx(),
    );
    await getAction(plugin, actions[5]).execute(
      { sessionId: "sess_1", taskId: "task_1" },
      ctx(),
    );
  });

  it("throws useful Steel API errors", async () => {
    const action = getAction(makeSteel(), "session.get");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "nope" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(
      action.execute({ id: "missing" }, ctx()),
      /Steel API error 401/,
    );
  });
});
