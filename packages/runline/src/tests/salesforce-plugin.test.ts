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

  it("uses OAuth client credentials without persisting tokens", async () => {
    const plugin = makeSalesforce();
    const seen: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method });
      if (String(url).endsWith("/services/oauth2/token")) {
        assert.equal(init?.method, "POST");
        assert.equal(
          String(init.body).includes("grant_type=client_credentials"),
          true,
        );
        return Response.json({
          access_token: "tok_test",
          instance_url: "https://example.my.salesforce.com",
          token_type: "Bearer",
          scope: "api",
          id: "https://login.salesforce.com/id/org/user",
        });
      }
      assert.equal(
        String(url),
        "https://example.my.salesforce.com/services/data/v59.0/query?q=SELECT+Id%2CName+FROM+Account+LIMIT+1",
      );
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer tok_test",
      );
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
    assert.equal(seen.length, 2);
  });

  it("returns Salesforce pagination metadata and fetches next pages", async () => {
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

    assert.deepEqual(page, {
      totalSize: 3,
      done: false,
      nextRecordsUrl: "/services/data/v60.0/query/01g-next",
      records: [{ Id: "001" }],
    });
    assert.deepEqual((next as { records: unknown[] }).records, [
      { Id: "002" },
      { Id: "003" },
    ]);
    assert.equal(
      urls[0],
      "https://example.my.salesforce.com/services/data/v60.0/query?q=SELECT+Id+FROM+Account",
    );
    assert.equal(
      urls[1],
      "https://example.my.salesforce.com/services/data/v60.0/query/01g-next",
    );
  });

  it("builds write requests with static access token auth", async () => {
    const plugin = makeSalesforce();
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      assert.equal(
        String(url),
        "https://example.my.salesforce.com/services/data/v59.0/sobjects/Account",
      );
      assert.equal(init?.method, "POST");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer tok",
      );
      assert.equal(init?.body, JSON.stringify({ Name: "Acme" }));
      return Response.json({ id: "001", success: true });
    }) as typeof fetch;

    const result = await getAction(plugin, "account.create").execute(
      { data: { Name: "Acme" } },
      ctx({
        instanceUrl: "https://example.my.salesforce.com",
        accessToken: "tok",
      }),
    );
    assert.deepEqual(result, { id: "001", success: true });
  });

  it("rejects Lightning UI URLs with a clear error", async () => {
    const plugin = makeSalesforce();
    await assert.rejects(
      getAction(plugin, "account.query").execute(
        { limit: 1 },
        ctx({
          instanceUrl: "https://example.lightning.force.com",
          accessToken: "tok",
        }),
      ),
      /not the Lightning UI URL/,
    );
  });
});
