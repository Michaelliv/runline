import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import facebookGraph from "../../../runline-plugins/facebookGraph/src/index.js";
import graphql from "../../../runline-plugins/graphql/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, RunlinePluginAPI } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(
  plugin: (rl: RunlinePluginAPI) => void,
  name: string,
  action: string,
  input: Record<string, unknown>,
  config: Record<string, unknown>,
) {
  const { api, resolve } = createPluginAPI(name);
  plugin(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name, plugin: name, config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

type Seen = { url: string; headers: Record<string, string>; body?: unknown };

function capture(reply: unknown) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url, init) => {
    seen.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body
        ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
        : undefined,
    });
    return Response.json(reply);
  }) as typeof fetch;
  return seen;
}

describe("graphql", () => {
  it("posts to the configured endpoint, unsigned without headerAuth, with its public headers", async () => {
    const seen = capture({ data: { me: { id: 1 } } });
    const result = await run(
      graphql,
      "graphql",
      "query",
      { query: "{ me { id } }", variables: { a: 1 } },
      {
        endpoint: "https://api.example.com/graphql",
        headers: { "X-Tenant": "t1" },
      },
    );
    assert.deepEqual(result, { me: { id: 1 } });
    assert.equal(seen[0].url, "https://api.example.com/graphql");
    assert.equal(seen[0].headers["x-tenant"], "t1");
    assert.equal(seen[0].headers.authorization, undefined);
    assert.deepEqual(seen[0].body, {
      query: "{ me { id } }",
      variables: { a: 1 },
    });
  });

  it("reports GraphQL errors by code, path and message", async () => {
    capture({
      errors: [
        {
          message: "Not allowed",
          path: ["me"],
          extensions: { code: "FORBIDDEN" },
        },
      ],
    });
    await assert.rejects(
      run(
        graphql,
        "graphql",
        "query",
        { query: "{ me { id } }" },
        {
          endpoint: "https://api.example.com/graphql",
          headerAuth: "Bearer t",
        },
      ),
      {
        message: "graphql: request failed (FORBIDDEN, param: me): Not allowed",
      },
    );
  });

  it("refuses a plain-HTTP endpoint, and a public header that claims Authorization", async () => {
    capture({});
    for (const config of [
      { endpoint: "http://api.example.com/graphql" },
      {
        endpoint: "https://api.example.com/graphql",
        headers: { Authorization: "Bearer leaked" },
      },
    ])
      await assert.rejects(
        run(graphql, "graphql", "query", { query: "{ x }" }, config),
      );
  });
});

describe("facebookGraph", () => {
  it("signs the chosen Meta host, with the version and node as segments", async () => {
    const seen = capture({ id: "v1" });
    await run(
      facebookGraph,
      "facebookGraph",
      "request",
      {
        hostUrl: "graph-video.facebook.com",
        method: "POST",
        graphApiVersion: "v19.0",
        node: "123",
        edge: "videos",
        body: { title: "t" },
      },
      { accessToken: "fb" },
    );
    assert.equal(
      seen[0].url,
      "https://graph-video.facebook.com/v19.0/123/videos?access_token=fb",
    );
    assert.deepEqual(seen[0].body, { title: "t" });
  });

  it("refuses any other host, a malformed version, or a caller copy of the token, before any request", async () => {
    const seen = capture({});
    for (const input of [
      { node: "me", hostUrl: "evil.example" },
      { node: "me", graphApiVersion: "../v1" },
      { node: "me", queryParameters: { access_token: "other" } },
      { node: "me/../../x" },
    ])
      await assert.rejects(
        run(facebookGraph, "facebookGraph", "request", input, {
          accessToken: "fb",
        }),
      );
    assert.equal(seen.length, 0);
  });
});
