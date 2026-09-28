import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import airtable from "../../../runline-plugins/airtable/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function action(name: string) {
  const { api, resolve } = createPluginAPI("airtable");
  airtable(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, `expected airtable.${name} to be registered`);
  return found;
}

const ctx: ActionContext = {
  connection: { name: "airtable", plugin: "airtable", config: { token: "t" } },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

describe("airtable record.search", () => {
  it("sends sort as Airtable's indexed field/direction parameters", async () => {
    const urls: URL[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      return Response.json({ records: [] });
    }) as typeof fetch;

    await action("record.search").execute(
      {
        baseId: "app1",
        tableId: "Tasks",
        fields: ["Name", "Due"],
        sort: [
          { field: "Due", direction: "asc" },
          { field: "Name", direction: "desc" },
        ],
      },
      ctx,
    );

    const params = urls[0].searchParams;
    assert.deepEqual(params.getAll("fields[]"), ["Name", "Due"]);
    assert.equal(params.get("sort[0][field]"), "Due");
    assert.equal(params.get("sort[0][direction]"), "asc");
    assert.equal(params.get("sort[1][field]"), "Name");
    assert.equal(params.get("sort[1][direction]"), "desc");
    assert.equal(params.has("sort[]"), false);
  });
});
