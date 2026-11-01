import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import zohoMail from "../../../runline-plugins/zohoMail/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("zohoMail");
zohoMail(api);
const plugin = resolve();

const ctx: ActionContext = {
  connection: {
    name: "mail",
    plugin: "zohoMail",
    config: {
      dc: "eu",
      clientId: "zoho_client",
      clientSecret: "zoho_secret",
      refreshToken: "zoho_refresh",
      accessToken: "zoho_access",
    },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

describe("zohoMail message.original", () => {
  it("calls the account-wide originalmessage URL, with no folder segment", async () => {
    const urls: string[] = [];
    stubFetch(async (url: RequestInfo | URL) => {
      if (String(url).includes("/oauth/v2/token"))
        return Response.json({ access_token: "a", expires_in: 3600 });
      urls.push(String(url));
      return Response.json({ data: { content: "From: a" } });
    });
    await getAction(plugin, "message.original").execute(
      { accountId: "1", folderId: "9", messageId: "42" },
      ctx,
    );
    const path = new URL(urls.at(-1) as string).pathname;
    assert.equal(path, "/api/accounts/1/messages/42/originalmessage");
  });
});
