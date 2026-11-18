import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import facebookGraph from "../../../runline-plugins/facebookGraph/src/index.js";
import graphql from "../../../runline-plugins/graphql/src/index.js";
import { createPluginAPI, type RunlinePluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext } from "../plugin/types.js";
import { stubFetch, typedSchema } from "./helpers/plugin.js";

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
  stubFetch(async (url, init) => {
    seen.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body
        ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
        : undefined,
    });
    return Response.json(reply);
  });
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

  it("refuses a plain-HTTP endpoint, and a public header that claims Authorization, before any request", async () => {
    const seen = capture({});
    for (const [config, code] of [
      [{ endpoint: "http://api.example.com/graphql" }, "invalid_credentials"],
      [
        {
          endpoint: "https://api.example.com/graphql",
          headers: { Authorization: "Bearer leaked" },
        },
        "invalid_definition",
      ],
    ] as const)
      await assert.rejects(
        run(graphql, "graphql", "query", { query: "{ x }" }, config),
        { code },
      );
    assert.equal(seen.length, 0);
  });
});

describe("facebookGraph", () => {
  it("takes one of Meta's hosts, a method, a version and plain parameters", () => {
    const { api, resolve } = createPluginAPI("facebookGraph");
    facebookGraph(api);
    const schema = typedSchema(resolve(), "request");
    const valid = (input: unknown) => validateTypedInput(schema, input).ok;
    assert.ok(valid({ node: "me" }));
    assert.ok(
      valid({
        hostUrl: "graph-video.facebook.com",
        method: "POST",
        graphApiVersion: "v27.0",
        node: "123",
        edge: "videos",
        fields: ["id", "name"],
        queryParameters: { limit: 5, summary: true, after: "a" },
        body: { title: "t", tags: ["a"] },
      }),
    );
    for (const input of [
      {},
      { node: "" },
      { node: "me", hostUrl: "evil.example" },
      { node: "me", method: "PUT" },
      { node: "me", method: "post" },
      { node: "me", graphApiVersion: "../v1" },
      { node: "me", fields: [] },
      { node: "me", fields: "id" },
      { node: "me", queryParameters: { nested: { a: 1 } } },
      { node: "me", body: ["a"] },
      { node: "me", extra: 1 },
    ])
      assert.equal(valid(input), false, JSON.stringify(input));
  });

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

  it("answers without the connection's token or a Page's", async () => {
    capture({
      data: [{ id: "1", name: "Page", access_token: "page-token" }],
      paging: {
        cursors: { after: "a" },
        next: "https://graph.facebook.com/me/accounts?access_token=fb&after=a",
        previous:
          "https://graph.facebook.com/me/accounts?before=b&access_token=fb",
      },
    });
    assert.deepEqual(
      await run(
        facebookGraph,
        "facebookGraph",
        "request",
        { node: "me", edge: "accounts" },
        { accessToken: "fb" },
      ),
      {
        data: [{ id: "1", name: "Page" }],
        paging: {
          cursors: { after: "a" },
          next: "https://graph.facebook.com/me/accounts?after=a",
          previous: "https://graph.facebook.com/me/accounts?before=b",
        },
      },
    );
  });

  it("sends fields as one parameter beside the caller's, and a body only with POST", async () => {
    const seen = capture({ id: "1" });
    const config = { accessToken: "fb" };
    await run(
      facebookGraph,
      "facebookGraph",
      "request",
      {
        node: "me",
        fields: ["id", "name"],
        queryParameters: { limit: 5 },
        body: { ignored: true },
      },
      config,
    );
    await run(
      facebookGraph,
      "facebookGraph",
      "request",
      { method: "POST", node: "1", edge: "feed", body: {} },
      config,
    );
    assert.equal(
      seen[0].url,
      "https://graph.facebook.com/me?limit=5&fields=id%2Cname&access_token=fb",
    );
    assert.equal(seen[0].body, undefined);
    assert.equal(
      seen[1].url,
      "https://graph.facebook.com/1/feed?access_token=fb",
    );
    assert.equal(seen[1].body, undefined);
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
        { code: "request_not_allowed" },
      );
    assert.equal(seen.length, 0);
  });
});
