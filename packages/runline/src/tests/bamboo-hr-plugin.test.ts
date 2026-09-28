import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import bambooHr from "../../../runline-plugins/bambooHr/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ctx: ActionContext = {
  connection: {
    name: "bambooHr",
    plugin: "bambooHr",
    config: { subdomain: "acme", apiKey: "k" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

function report(input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("bambooHr");
  bambooHr(api);
  const action = resolve().actions.find((a) => a.name === "companyReport.get");
  assert.ok(action);
  return Promise.resolve(action.execute({ reportId: "7", ...input }, ctx));
}

describe("bambooHr companyReport.get", () => {
  it("answers the report itself: parsed JSON, or CSV and XML as text", async () => {
    const bodies: Record<string, [string, string]> = {
      JSON: ['{"title":"r"}', "application/json"],
      CSV: ["id,name\n1,Ada\n", "text/csv"],
      XML: ["<report/>", "application/xml"],
    };
    globalThis.fetch = (async (url) => {
      const format = new URL(String(url)).searchParams.get("format") ?? "";
      const [body, type] = bodies[format];
      return new Response(body, { headers: { "content-type": type } });
    }) as typeof fetch;
    assert.deepEqual(await report({}), { title: "r" });
    assert.equal(await report({ format: "CSV" }), "id,name\n1,Ada\n");
    assert.equal(await report({ format: "XML" }), "<report/>");
  });

  it("refuses a format it cannot return, before any request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("no request expected");
    }) as typeof fetch;
    for (const format of ["PDF", "XLS"])
      await assert.rejects(report({ format }), {
        message: "bambooHr: format must be JSON, CSV, or XML",
      });
  });
});
