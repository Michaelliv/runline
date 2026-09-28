/**
 * APIs that answer 2xx with a failure in the body report it by the
 * provider's error code alone, as a failed HTTP status is reported —
 * never with the provider's free text, which can echo request data.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import slack from "../../../runline-plugins/slack/src/index.js";
import telegram from "../../../runline-plugins/telegram/src/index.js";
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

describe("failures inside a 2xx answer", () => {
  it("slack reports its error code", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        ok: false,
        error: "channel_not_found",
        detail: "private",
      })) as typeof fetch;
    await assert.rejects(
      run(
        slack,
        "slack",
        "channel.join",
        { channel: "C1" },
        { accessToken: "xoxb" },
      ),
      { message: "slack: request failed (channel_not_found)" },
    );
  });

  it("telegram reports its error code, never its description", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        ok: false,
        error_code: 400,
        description: "Bad Request: private chat text",
      })) as typeof fetch;
    await assert.rejects(
      run(
        telegram,
        "telegram",
        "chat.get",
        { chatId: "1" },
        { accessToken: "1:A" },
      ),
      { message: "telegram: request failed (400)" },
    );
  });
});
