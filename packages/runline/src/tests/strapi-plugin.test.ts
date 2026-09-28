import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import strapi from "../../../runline-plugins/strapi/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(
  action: string,
  input: Record<string, unknown>,
  config: Record<string, unknown>,
) {
  const { api, resolve } = createPluginAPI("strapi");
  strapi(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const updates: Array<Record<string, unknown>> = [];
  const ctx: ActionContext = {
    connection: { name: "s", plugin: "strapi", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(config) : change;
      if (patch) {
        updates.push(patch);
        Object.assign(config, patch);
      }
    },
  };
  return { result: Promise.resolve(found.execute(input, ctx)), updates };
}

describe("strapi with an email and password", () => {
  it("logs in for a JWT, keeps it, and signs entries with it", async () => {
    const seen: Array<{ url: string; auth: string | null; body?: unknown }> =
      [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: init?.body
          ? JSON.parse(
              typeof init.body === "string"
                ? init.body
                : new TextDecoder().decode(init.body as Uint8Array),
            )
          : undefined,
      });
      return String(url).endsWith("/auth/local")
        ? Response.json({ jwt: "jwt1", user: { id: 1 } })
        : Response.json({ data: [{ id: 1 }] });
    }) as typeof fetch;
    const config: Record<string, unknown> = {
      url: "https://cms.example.com",
      email: "me@x.io",
      password: "pw",
    };
    const first = run("entry.list", { contentType: "articles" }, config);
    assert.deepEqual(await first.result, [{ id: 1 }]);
    assert.equal(first.updates[0]?.accessToken, "jwt1");
    await run("entry.list", { contentType: "articles" }, config).result;
    assert.deepEqual(seen, [
      {
        url: "https://cms.example.com/api/auth/local",
        auth: null,
        body: { identifier: "me@x.io", password: "pw" },
      },
      {
        url: "https://cms.example.com/api/articles",
        auth: "Bearer jwt1",
        body: undefined,
      },
      {
        url: "https://cms.example.com/api/articles",
        auth: "Bearer jwt1",
        body: undefined,
      },
    ]);
  });

  it("uses the v3 paths, with no /api prefix", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url) => {
      seen.push(String(url));
      return String(url).endsWith("/auth/local")
        ? Response.json({ jwt: "j" })
        : Response.json({ id: 1 });
    }) as typeof fetch;
    await run(
      "entry.get",
      { contentType: "articles", entryId: "a b" },
      {
        url: "https://cms.example.com",
        apiVersion: "v3",
        email: "e",
        password: "p",
      },
    ).result;
    assert.deepEqual(seen, [
      "https://cms.example.com/auth/local",
      "https://cms.example.com/articles/a%20b",
    ]);
  });

  it("refuses an API version it does not know", async () => {
    globalThis.fetch = (async () => {
      throw new Error("no request expected");
    }) as typeof fetch;
    await assert.rejects(
      run(
        "entry.list",
        { contentType: "articles" },
        { url: "https://cms.example.com", apiVersion: "4", apiToken: "t" },
      ).result,
      { code: "invalid_credentials" },
    );
  });
});
