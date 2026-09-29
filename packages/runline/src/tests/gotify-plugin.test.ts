import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import gotify from "../../../runline-plugins/gotify/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("gotify", () => {
  it("reads and deletes with the client token, in the same header as the app token", async () => {
    const { api, resolve } = createPluginAPI("gotify");
    gotify(api);
    const action = resolve().actions.find((a) => a.name === "message.delete");
    assert.ok(action);
    const seen: Array<{ url: string; key: string | null }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        key: new Headers(init?.headers).get("x-gotify-key"),
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const ctx: ActionContext = {
      connection: {
        name: "g",
        plugin: "gotify",
        config: {
          url: "https://gotify.example.com",
          appApiToken: "app_tok",
          clientApiToken: "client_tok",
        },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    await action.execute({ messageId: "7" }, ctx);
    assert.deepEqual(seen, [
      { url: "https://gotify.example.com/message/7", key: "client_tok" },
    ]);
  });
});
