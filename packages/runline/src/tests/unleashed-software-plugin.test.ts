import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import unleashedSoftware from "../../../runline-plugins/unleashedSoftware/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("unleashedSoftware", () => {
  it("signs the query it sends with the API key, beside the API ID", async () => {
    const { api, resolve } = createPluginAPI("unleashedSoftware");
    unleashedSoftware(api);
    const action = resolve().actions.find((a) => a.name === "salesOrder.list");
    assert.ok(action);
    const seen: Array<{
      url: string;
      id: string | null;
      sig: string | null;
      type: string | null;
    }> = [];
    globalThis.fetch = (async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(url),
        id: headers.get("api-auth-id"),
        sig: headers.get("api-auth-signature"),
        type: headers.get("content-type"),
      });
      return Response.json({ Items: [] });
    }) as typeof fetch;
    const ctx: ActionContext = {
      connection: {
        name: "ul",
        plugin: "unleashedSoftware",
        config: { apiId: "id1", apiKey: "key1" },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    await action.execute(
      { startDate: "2024-01-01", orderStatus: "Parked,Completed", limit: 5 },
      ctx,
    );
    const query =
      "startDate=2024-01-01&orderStatus=Parked%2CCompleted&pageSize=5";
    assert.deepEqual(seen, [
      {
        url: `https://api.unleashedsoftware.com/SalesOrders/1?${query}`,
        id: "id1",
        sig: createHmac("sha256", "key1").update(query).digest("base64"),
        type: "application/json",
      },
    ]);
  });
});
