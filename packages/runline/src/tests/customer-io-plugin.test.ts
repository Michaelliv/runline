import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import customerIo from "../../../runline-plugins/customerIo/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("customerIo App API", () => {
  it("signs with the app key as a bearer, in the connection's region, with metric options as query", async () => {
    const { api, resolve } = createPluginAPI("customerIo");
    customerIo(api);
    const action = resolve().actions.find(
      (a) => a.name === "campaign.getMetrics",
    );
    assert.ok(action);
    const seen: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ metric: {} });
    }) as typeof fetch;
    const ctx: ActionContext = {
      connection: {
        name: "cio",
        plugin: "customerIo",
        config: {
          siteId: "s",
          trackingApiKey: "t",
          appApiKey: "app1",
          region: "track-eu.customer.io",
        },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    await action.execute(
      { campaignId: 7, period: "weeks", steps: 4, type: "urbanAirship" },
      ctx,
    );
    assert.deepEqual(seen, [
      {
        url: "https://api-eu.customer.io/v1/campaigns/7/metrics?period=weeks&steps=4&type=urban_airship",
        auth: "Bearer app1",
      },
    ]);
  });
});
