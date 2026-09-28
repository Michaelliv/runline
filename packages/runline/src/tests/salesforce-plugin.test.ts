import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import salesforce from "../../../runline-plugins/salesforce/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeSalesforce(): PluginDef {
  const { api, resolve } = createPluginAPI("salesforce");
  salesforce(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected salesforce.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "salesforce",
      plugin: "salesforce",
      config,
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

describe("salesforce plugin", () => {
  it("registers existing actions plus refreshed metadata actions", () => {
    const plugin = makeSalesforce();
    const names = plugin.actions.map((a) => a.name);
    for (const name of [
      "connection.test",
      "auth.identity",
      "limits.get",
      "metadata.objects",
      "soql.query",
      "soql.queryAll",
      "soql.queryPage",
      "soql.queryAllPage",
      "soql.nextPage",
      "account.create",
      "account.get",
      "account.update",
      "account.delete",
      "account.query",
      "account.queryPage",
      "account.upsert",
      "sobject.describe",
    ]) {
      assert.ok(names.includes(name), name);
    }
  });

  it("exchanges client credentials at the My Domain token endpoint and signs with the token", async () => {
    const plugin = makeSalesforce();
    const seen: Array<{ url: string; method?: string; auth: string | null }> =
      [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(url),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
      });
      if (String(url).endsWith("/services/oauth2/token")) {
        const fields = new URLSearchParams(String(init?.body));
        assert.equal(fields.get("grant_type"), "client_credentials");
        assert.equal(fields.get("client_id"), "client");
        assert.equal(fields.get("client_secret"), "secret");
        return Response.json({
          access_token: "tok_test",
          instance_url: "https://example.my.salesforce.com",
          token_type: "Bearer",
        });
      }
      return Response.json({ records: [{ Id: "001", Name: "Acme" }] });
    }) as typeof fetch;

    const result = await getAction(plugin, "soql.query").execute(
      { query: "SELECT Id,Name FROM Account LIMIT 1" },
      ctx({
        loginUrl: "https://example.my.salesforce.com",
        clientId: "client",
        clientSecret: "secret",
      }),
    );

    assert.deepEqual(result, [{ Id: "001", Name: "Acme" }]);
    assert.deepEqual(seen, [
      {
        url: "https://example.my.salesforce.com/services/oauth2/token",
        method: "POST",
        auth: null,
      },
      {
        url: "https://example.my.salesforce.com/services/data/v59.0/query?q=SELECT+Id%2CName+FROM+Account+LIMIT+1",
        method: "GET",
        auth: "Bearer tok_test",
      },
    ]);
  });

  it("returns Salesforce pagination metadata and fetches next pages on the instance alone", async () => {
    const plugin = makeSalesforce();
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      urls.push(String(url));
      if (String(url).includes("/query?q=")) {
        return Response.json({
          totalSize: 3,
          done: false,
          nextRecordsUrl: "/services/data/v60.0/query/01g-next",
          records: [{ Id: "001" }],
        });
      }
      return Response.json({
        totalSize: 3,
        done: true,
        records: [{ Id: "002" }, { Id: "003" }],
      });
    }) as typeof fetch;

    const context = ctx({
      instanceUrl: "https://example.my.salesforce.com",
      accessToken: "tok",
      apiVersion: "60.0",
    });
    const page = await getAction(plugin, "soql.queryPage").execute(
      { query: "SELECT Id FROM Account" },
      context,
    );
    const next = await getAction(plugin, "soql.nextPage").execute(
      { nextRecordsUrl: (page as { nextRecordsUrl: string }).nextRecordsUrl },
      context,
    );

    assert.deepEqual((next as { records: unknown[] }).records, [
      { Id: "002" },
      { Id: "003" },
    ]);
    assert.deepEqual(urls, [
      "https://example.my.salesforce.com/services/data/v60.0/query?q=SELECT+Id+FROM+Account",
      "https://example.my.salesforce.com/services/data/v60.0/query/01g-next",
    ]);
    await assert.rejects(
      getAction(plugin, "soql.nextPage").execute(
        { nextRecordsUrl: "https://evil.example/services/data/v60.0/query/x" },
        context,
      ),
      { code: "request_not_allowed" },
    );
    assert.equal(urls.length, 2);
  });

  it("builds write requests with static access token auth, IDs as one segment", async () => {
    const plugin = makeSalesforce();
    const seen: Array<{
      url: string;
      method?: string;
      auth: string | null;
      body: string;
    }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(url),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
        body: new TextDecoder().decode(init?.body as Uint8Array),
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const result = await getAction(plugin, "account.update").execute(
      { id: "001 x", data: { Name: "Acme" } },
      ctx({
        instanceUrl: "https://example.my.salesforce.com",
        accessToken: "tok",
      }),
    );
    assert.deepEqual(result, { success: true, id: "001 x" });
    assert.deepEqual(seen, [
      {
        url: "https://example.my.salesforce.com/services/data/v59.0/sobjects/Account/001%20x",
        method: "PATCH",
        auth: "Bearer tok",
        body: JSON.stringify({ Name: "Acme" }),
      },
    ]);
  });

  it("reads the OAuth identity from the instance's userinfo endpoint", async () => {
    const plugin = makeSalesforce();
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      urls.push(String(url));
      return Response.json({ user_id: "005" });
    }) as typeof fetch;
    const result = await getAction(plugin, "auth.identity").execute(
      {},
      ctx({
        instanceUrl: "https://example.my.salesforce.com",
        accessToken: "tok",
      }),
    );
    assert.deepEqual(result, { user_id: "005" });
    assert.deepEqual(urls, [
      "https://example.my.salesforce.com/services/oauth2/userinfo",
    ]);
  });

  it("refuses a Lightning UI URL, which serves no API", async () => {
    const plugin = makeSalesforce();
    await assert.rejects(
      getAction(plugin, "account.query").execute(
        { limit: 1 },
        ctx({
          instanceUrl: "https://example.lightning.force.com",
          accessToken: "tok",
        }),
      ),
      { code: "invalid_credentials" },
    );
  });
});
