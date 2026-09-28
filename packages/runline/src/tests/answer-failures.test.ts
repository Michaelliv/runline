/**
 * APIs that answer 2xx with a failure in the body report it through one
 * shared reading: the provider's code, the field at fault and its message.
 * The answer is 2xx data the plugin already holds, so its message is kept
 * for the caller to act on.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import emelia from "../../../runline-plugins/emelia/src/index.js";
import linear from "../../../runline-plugins/linear/src/index.js";
import mautic from "../../../runline-plugins/mautic/src/index.js";
import monday from "../../../runline-plugins/monday/src/index.js";
import pipedrive from "../../../runline-plugins/pipedrive/src/index.js";
import slack from "../../../runline-plugins/slack/src/index.js";
import telegram from "../../../runline-plugins/telegram/src/index.js";
import yourls from "../../../runline-plugins/yourls/src/index.js";
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

const graphqlErrors = {
  errors: [
    {
      message: "Entity not found: Issue",
      path: ["node"],
      extensions: { code: "NOT_FOUND" },
    },
  ],
};

describe("failures inside a 2xx answer", () => {
  for (const [plugin, name, action, input, config] of [
    [linear, "linear", "team.get", { id: "T" }, { apiKey: "lin" }],
    [monday, "monday", "board.get", { boardId: "1" }, { apiToken: "m" }],
    [emelia, "emelia", "campaign.get", { campaignId: "1" }, { apiKey: "e" }],
  ] as const)
    it(`${name} reports a GraphQL error by its code, path and message`, async () => {
      globalThis.fetch = (async () =>
        Response.json(graphqlErrors)) as typeof fetch;
      await assert.rejects(run(plugin, name, action, input, config), {
        message: `${name}: request failed (NOT_FOUND, param: node): Entity not found: Issue`,
      });
    });

  it("mautic reports its error code and message", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        errors: [{ code: 404, message: "Item was not found." }],
      })) as typeof fetch;
    await assert.rejects(
      run(
        mautic,
        "mautic",
        "company.get",
        { companyId: "1" },
        { url: "https://m.example.com", username: "u", password: "p" },
      ),
      { message: "mautic: request failed (404): Item was not found." },
    );
  });

  it("pipedrive reports its error code and message", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        success: false,
        error: "Deal not found",
        errorCode: 404,
      })) as typeof fetch;
    await assert.rejects(
      run(pipedrive, "pipedrive", "deal.get", { id: 1 }, { apiToken: "pd" }),
      { message: "pipedrive: request failed (404): Deal not found" },
    );
  });

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

  it("yourls reports its error code and message", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "fail",
        code: "error:keyword",
        message: "Short URL private-keyword already exists",
      })) as typeof fetch;
    await assert.rejects(
      run(
        yourls,
        "yourls",
        "url.shorten",
        { url: "https://example.com", keyword: "private-keyword" },
        { url: "https://sho.rt", signature: "sig" },
      ),
      {
        message:
          "yourls: request failed (error:keyword): Short URL private-keyword already exists",
      },
    );
  });

  it("telegram reports its error code and description", async () => {
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
      {
        message:
          "telegram: request failed (400): Bad Request: private chat text",
      },
    );
  });
});
