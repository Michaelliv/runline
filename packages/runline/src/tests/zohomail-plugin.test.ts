import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import { DownloadedFile } from "../../../runline-plugins/_shared/base64.js";
import { DC, DCS } from "../../../runline-plugins/zohoMail/src/credentials.js";
import zohoMail from "../../../runline-plugins/zohoMail/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("zohoMail");
zohoMail(api);
const plugin = resolve();

/** A connection whose updates commit, as a store's would. */
function context(config: Record<string, unknown> = {}): ActionContext {
  const connection = {
    name: "mail",
    plugin: "zohoMail",
    config: {
      dc: "eu",
      clientId: "zoho_client",
      clientSecret: "zoho_secret",
      refreshToken: "zoho_refresh",
      accessToken: "zoho_access",
      ...config,
    },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) connection.config = { ...connection.config, ...patch };
    },
  };
}
const ctx = context();

async function run(name: string, input: unknown, at = ctx) {
  return getAction(plugin, name).execute(input, at);
}
/** The engine's verdict on an input, normalization included. */
function valid(name: string, input: unknown) {
  return validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;
}
function mock(response: () => Response = () => Response.json({ data: [] })) {
  const calls: { url: URL; init: RequestInit }[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), init: init ?? {} });
    return response();
  });
  return calls;
}
const header = (init: RequestInit, name: string) =>
  new Headers(init.headers).get(name);

const m = "accounts/1/folders/9/messages/42";
// Each action's input, path beneath https://mail.zoho.eu/api/ and query.
const routes: Array<[string, Record<string, unknown>, string, string?]> = [
  ["account.list", {}, "accounts"],
  ["folder.list", { accountId: "1" }, "accounts/1/folders"],
  ["label.list", { accountId: "1" }, "accounts/1/labels"],
  [
    "message.list",
    {
      accountId: "1",
      folderId: "9",
      start: 2,
      limit: 50,
      status: "unread",
      includeto: true,
    },
    "accounts/1/messages/view",
    "folderId=9&start=2&limit=50&status=unread&includeto=true",
  ],
  [
    "message.search",
    { accountId: "1", searchKey: "sender:a@b.c::has:attachment", limit: 5 },
    "accounts/1/messages/search",
    "searchKey=sender%3Aa%40b.c%3A%3Ahas%3Aattachment&limit=5",
  ],
  [
    "message.content",
    { accountId: "1", folderId: "9", messageId: "42" },
    `${m}/content`,
  ],
  [
    "message.content",
    {
      accountId: "1",
      folderId: "9",
      messageId: "42",
      includeBlockContent: true,
    },
    `${m}/content`,
    "includeBlockContent=true",
  ],
  [
    "message.attachmentInfo",
    { accountId: "1", folderId: "9", messageId: "42" },
    `${m}/attachmentinfo`,
  ],
  [
    "message.attachment",
    { accountId: "1", folderId: "9", messageId: "42", attachmentId: "7" },
    `${m}/attachments/7`,
  ],
  // Account-wide: Zoho answers 404 when the path carries a folder.
  [
    "message.original",
    { accountId: "1", messageId: "42" },
    "accounts/1/messages/42/originalmessage",
  ],
];

describe("zohoMail routes", () => {
  it("covers every registered action", () => {
    assert.deepEqual(
      [...new Set(routes.map(([name]) => name))].sort(),
      plugin.actions.map((a) => a.name).sort(),
    );
  });

  for (const [name, input, path, query = ""] of routes)
    it(`${name} reads ${path}${query ? `?${query}` : ""}`, async () => {
      assert.ok(valid(name, input), "input should validate");
      const calls = mock(() =>
        name === "message.attachment"
          ? new Response("x")
          : Response.json({ data: [] }),
      );
      await run(name, input);
      assert.equal(calls.length, 1);
      const [{ url, init }] = calls;
      assert.equal(url.origin, "https://mail.zoho.eu");
      assert.equal(url.pathname, `/api/${path}`);
      assert.equal(url.search.slice(1), query);
      assert.equal(init.method, "GET");
      assert.equal(header(init, "authorization"), "Bearer zoho_access");
      assert.equal(
        header(init, "accept"),
        name === "message.attachment" ? "*/*" : "application/json",
      );
    });

  it("unwraps Zoho's data envelope", async () => {
    mock(() =>
      Response.json({ status: { code: 200 }, data: [{ accountId: "1" }] }),
    );
    assert.deepEqual(await run("account.list", {}), [{ accountId: "1" }]);
  });
});

describe("zohoMail inputs", () => {
  it("requires a non-empty folderId to list messages", () => {
    assert.equal(valid("message.list", { accountId: "1" }), false);
    assert.equal(
      valid("message.list", { accountId: "1", folderId: "" }),
      false,
    );
  });

  it("bounds start and limit to Zoho's integers", () => {
    const list = { accountId: "1", folderId: "9" };
    assert.equal(valid("message.list", { ...list, limit: 200 }), true);
    assert.equal(valid("message.list", { ...list, limit: 201 }), false);
    assert.equal(valid("message.list", { ...list, limit: 2.5 }), false);
    assert.equal(valid("message.list", { ...list, start: 0 }), false);
  });

  it("refuses fields an action does not read", () => {
    assert.equal(
      valid("message.original", {
        accountId: "1",
        folderId: "9",
        messageId: "42",
      }),
      false,
    );
  });

  it("takes the connection's accountId when the call has none", async () => {
    const calls = mock();
    await run("folder.list", {}, context({ accountId: "77" }));
    assert.equal(calls[0].url.pathname, "/api/accounts/77/folders");
  });

  it("asks for an accountId before any request when neither has one", async () => {
    const calls = mock();
    await assert.rejects(run("label.list", {}), /accountId required/);
    assert.equal(calls.length, 0);
  });

  it("refuses an id that is not one path segment", async () => {
    mock();
    await assert.rejects(
      run("message.content", {
        accountId: "1",
        folderId: "../2",
        messageId: "42",
      }),
      { code: "request_not_allowed" },
    );
  });
});

describe("zohoMail failures", () => {
  const refusal = () =>
    Response.json(
      {
        status: { code: 404, description: "Invalid Input" },
        data: {
          errorCode: "URL_RULE_NOT_CONFIGURED",
          moreInfo: "echoes zoho_access",
        },
      },
      { status: 404 },
    );

  for (const [name, input] of [
    ["folder.list", { accountId: "1" }],
    [
      "message.attachment",
      { accountId: "1", folderId: "9", messageId: "42", attachmentId: "7" },
    ],
  ] as const)
    it(`${name} reports Zoho's errorCode and never its text`, async () => {
      mock(refusal);
      await assert.rejects(run(name, input), (error: Error) => {
        assert.equal(
          error.message,
          "zohoMail: request failed (HTTP 404 URL_RULE_NOT_CONFIGURED)",
        );
        assert.equal((error as Error & { status: number }).status, 404);
        return true;
      });
    });
});

describe("zohoMail message.attachment", () => {
  it("answers the bytes as a download other plugins accept", async () => {
    const bytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff]);
    mock(
      () =>
        new Response(bytes, {
          headers: { "Content-Type": "application/gzip; name=a.gz" },
        }),
    );
    const result = await run("message.attachment", {
      accountId: "1",
      folderId: "9",
      messageId: "42",
      attachmentId: "7",
    });
    assert.deepEqual(result, {
      contentBase64: bytes.toString("base64"),
      mimeType: "application/gzip",
      size: 5,
    });
    assert.ok(Check(DownloadedFile, result));
  });
});

describe("zohoMail data centres", () => {
  it("renews at the accounts host of the API's own data centre", async () => {
    for (const dc of DCS) {
      const calls = mock(() =>
        calls.length === 1
          ? Response.json({ access_token: "fresh", expires_in: 3600 })
          : Response.json({ data: [] }),
      );
      await run(
        "account.list",
        {},
        context({ dc, accessToken: undefined, accountId: "1" }),
      );
      assert.equal(calls[0].url.href, `${DC[dc].accounts}/oauth/v2/token`);
      assert.equal(calls[1].url.href, `${DC[dc].api}/api/accounts`);
      assert.equal(header(calls[1].init, "authorization"), "Bearer fresh");
    }
  });

  it('defaults to "com" and refuses an undocumented dc', async () => {
    const calls = mock();
    await run("account.list", {}, context({ dc: undefined }));
    assert.equal(calls[0].url.origin, "https://mail.zoho.com");
    await assert.rejects(run("account.list", {}, context({ dc: "us" })), {
      code: "invalid_credentials",
    });
    assert.equal(calls.length, 1);
  });
});
