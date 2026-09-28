import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import odoo from "../../../runline-plugins/odoo/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(action: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("odoo");
  odoo(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: {
      name: "o",
      plugin: "odoo",
      config: { url: "https://acme.odoo.com", username: "me", password: "pw" },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("odoo", () => {
  it("logs in, then calls the model, the password filled into each call's slot", async () => {
    const params: unknown[] = [];
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), "https://acme.odoo.com/jsonrpc");
      const body = JSON.parse(
        new TextDecoder().decode(init?.body as Uint8Array),
      );
      params.push(body.params);
      return Response.json({ result: params.length === 1 ? 7 : [{ id: 3 }] });
    }) as typeof fetch;
    const result = await run("record.get", { model: "contact", id: 3 });
    assert.deepEqual(result, [{ id: 3 }]);
    assert.deepEqual(params, [
      { service: "common", method: "login", args: ["acme", "me", "pw"] },
      {
        service: "object",
        method: "execute",
        args: ["acme", 7, "pw", "res.partner", "read", [3], []],
      },
    ]);
  });

  it("reports an RPC error by its exception name and message", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        error: {
          code: 200,
          message: "Odoo Server Error",
          data: {
            name: "odoo.exceptions.AccessDenied",
            message: "Access Denied",
          },
        },
      })) as typeof fetch;
    await assert.rejects(run("record.get", { model: "contact", id: 3 }), {
      message:
        "odoo: request failed (odoo.exceptions.AccessDenied): Access Denied",
    });
  });

  it("refuses a login that returns no user", async () => {
    globalThis.fetch = (async () =>
      Response.json({ result: false })) as typeof fetch;
    await assert.rejects(run("record.get", { model: "contact", id: 3 }), {
      code: "invalid_credentials",
    });
  });
});
