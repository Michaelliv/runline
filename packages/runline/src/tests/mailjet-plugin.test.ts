import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import mailjet from "../../../runline-plugins/mailjet/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(
  config: Record<string, unknown>,
  action = "sms.send",
  input: Record<string, unknown> = { from: "A", to: "+1", text: "t" },
) {
  const { api, resolve } = createPluginAPI("mailjet");
  mailjet(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "mj", plugin: "mailjet", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
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

describe("mailjet email", () => {
  const keys = { apiKeyPublic: "p", apiKeyPrivate: "s", sandboxMode: "true" };
  const shared = {
    fromEmail: "a@example.com",
    fromName: "A",
    toEmail: "b@example.com, c@example.com",
    subject: "s",
    cc: "d@example.com",
    replyTo: "r@example.com",
    priority: 2,
    templateLanguage: false,
  };
  const common = {
    From: { Email: "a@example.com", Name: "A" },
    Subject: "s",
    To: [{ Email: "b@example.com" }, { Email: "c@example.com" }],
    Cc: [{ Email: "d@example.com" }],
    ReplyTo: { Email: "r@example.com" },
    TemplateLanguage: false,
    Priority: 2,
  };

  it("builds one message shape for plain and template sends, in sandbox when configured", async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ Messages: [] });
    }) as typeof fetch;
    await run(keys, "email.send", { ...shared, textPart: "hi" });
    await run(keys, "email.sendTemplate", { ...shared, templateId: 9 });
    assert.deepEqual(bodies, [
      { Messages: [{ ...common, TextPart: "hi" }], SandboxMode: true },
      { Messages: [{ ...common, TemplateID: 9 }], SandboxMode: true },
    ]);
  });
});
