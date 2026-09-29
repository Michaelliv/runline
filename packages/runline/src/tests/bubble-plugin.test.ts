import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import bubble from "../../../runline-plugins/bubble/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function list(config: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("bubble");
  bubble(api);
  const action = resolve().actions.find((a) => a.name === "object.list");
  assert.ok(action);
  const ctx: ActionContext = {
    connection: {
      name: "bubble",
      plugin: "bubble",
      config: { apiToken: "t", appName: "myapp", ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(action.execute({ typeName: "Thing" }, ctx));
}

describe("bubble", () => {
  it("refuses a self-hosted connection without a domain instead of sending its token to bubbleapps.io", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url) => {
      urls.push(String(url));
      return Response.json({ response: { results: [], remaining: 0 } });
    }) as typeof fetch;
    await list({});
    assert.equal(urls.length, 1);
    await assert.rejects(list({ hosting: "selfHosted" }), {
      code: "invalid_credentials",
    });
    assert.equal(urls.length, 1);
  });

  it("stops paging when a page omits its remaining count", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls > 3) throw new Error("unbounded paging");
      return Response.json({ response: { results: [{ id: calls }] } });
    }) as typeof fetch;
    assert.deepEqual(await list({}), [{ id: 1 }]);
  });
});
