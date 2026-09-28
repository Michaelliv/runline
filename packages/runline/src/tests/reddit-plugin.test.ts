import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import reddit from "../../../runline-plugins/reddit/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(
  action: string,
  input: Record<string, unknown>,
  config: Record<string, unknown> = {},
) {
  const { api, resolve } = createPluginAPI("reddit");
  reddit(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "rd", plugin: "reddit", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("reddit without a token", () => {
  it("reads public listings unsigned from www.reddit.com", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ data: { children: [] } });
    }) as typeof fetch;
    await run("post.list", { subreddit: "node", category: "new" });
    assert.deepEqual(seen, [
      {
        url: "https://www.reddit.com/r/node/new.json?api_type=json",
        auth: null,
      },
    ]);
  });

  it("refuses a write before any request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("no request expected");
    }) as typeof fetch;
    await assert.rejects(run("post.delete", { postId: "abc" }), {
      code: "request_not_allowed",
    });
  });
});

describe("reddit with a token", () => {
  it("sends a write's parameters as a form body, never in the URL", async () => {
    const seen: Array<{ url: string; type: string | null; body: string }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        type: new Headers(init?.headers).get("content-type"),
        body: String(init?.body),
      });
      return Response.json({ json: { data: { things: [{ data: {} }] } } });
    }) as typeof fetch;
    await run(
      "comment.create",
      { postId: "abc", text: "hello there" },
      { accessToken: "tok" },
    );
    assert.deepEqual(seen, [
      {
        url: "https://oauth.reddit.com/api/comment",
        type: "application/x-www-form-urlencoded",
        body: "thing_id=t3_abc&text=hello+there&api_type=json",
      },
    ]);
  });
});
