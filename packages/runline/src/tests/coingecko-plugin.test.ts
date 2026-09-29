import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import coingecko from "../../../runline-plugins/coingecko/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("coingecko without a key", () => {
  it("reaches the public API unsigned", async () => {
    const { api, resolve } = createPluginAPI("coingecko");
    coingecko(api);
    const action = resolve().actions.find((a) => a.name === "coin.list");
    assert.ok(action);
    const seen: Array<{ url: string; key: string | null }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        key: new Headers(init?.headers).get("x-cg-demo-api-key"),
      });
      return Response.json([]);
    }) as typeof fetch;
    const ctx: ActionContext = {
      connection: { name: "cg", plugin: "coingecko", config: {} },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    await action.execute({}, ctx);
    assert.deepEqual(seen, [
      { url: "https://api.coingecko.com/api/v3/coins/list", key: null },
    ]);
  });
});
