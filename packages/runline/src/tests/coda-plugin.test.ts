import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import coda from "../../../runline-plugins/coda/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("coda table.deleteRow", () => {
  it("names the row to delete in the request body", async () => {
    const { api, resolve } = createPluginAPI("coda");
    coda(api);
    const action = resolve().actions.find((a) => a.name === "table.deleteRow");
    assert.ok(action);
    const sent: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = (async (url, init) => {
      sent.push({
        url: String(url),
        method: init?.method,
        body: init?.body
          ? new TextDecoder().decode(init.body as Uint8Array)
          : undefined,
      });
      return Response.json({ requestId: "r" });
    }) as typeof fetch;
    const ctx: ActionContext = {
      connection: {
        name: "coda",
        plugin: "coda",
        config: { accessToken: "t" },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    await action.execute({ docId: "d", tableId: "t", rowId: "r1" }, ctx);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://coda.io/apis/v1/docs/d/tables/t/rows");
    assert.equal(sent[0].method, "DELETE");
    assert.deepEqual(JSON.parse(sent[0].body ?? "null"), { rowIds: ["r1"] });
  });
});
