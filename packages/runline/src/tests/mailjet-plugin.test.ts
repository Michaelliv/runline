import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import mailjet from "../../../runline-plugins/mailjet/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(config: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("mailjet");
  mailjet(api);
  const found = resolve().actions.find((a) => a.name === "sms.send");
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "mj", plugin: "mailjet", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(
    found.execute({ from: "A", to: "+1", text: "t" }, ctx),
  );
}

describe("mailjet sms", () => {
  it("signs the SMS API with its own bearer token", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({});
    }) as typeof fetch;
    await run({ apiKeyPublic: "p", apiKeyPrivate: "s", smsToken: "sms1" });
    assert.deepEqual(seen, [
      { url: "https://api.mailjet.com/v4/sms-send", auth: "Bearer sms1" },
    ]);
  });

  it("refuses SMS without a token, before any request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("no request expected");
    }) as typeof fetch;
    await assert.rejects(run({ apiKeyPublic: "p", apiKeyPrivate: "s" }), {
      code: "invalid_credentials",
    });
  });
});
