import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftPages from "../../../runline-plugins/shiftPages/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_PAGES_ACTIONS = [
  "page.archive",
  "page.create",
  "page.get",
  "page.list",
  "page.publish",
  "page.renderUrl",
  "page.revokeShare",
  "page.share",
  "page.shares",
  "page.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftPages(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftPages");
  shiftPages(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftPages.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftPages",
      plugin: "shiftPages",
      config: { apiKey: "shift_test" },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    async updateConnection() {},
  };
}

function mockShift(assertRequest: (input: URL, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const data = assertRequest(input as URL, init);
    if (data === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("shiftPages plugin", () => {
  it("registers the hosted pages surface", () => {
    const plugin = makeShiftPages();
    assert.equal(plugin.name, "shiftPages");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_PAGES_ACTIONS,
    ]);
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftPages().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("validates slugs and share emails strictly", () => {
    const plugin = makeShiftPages();
    assert.equal(
      Check(getAction(plugin, "page.create").inputSchema as never, {
        slug: "Investor Update",
        title: "Investor Update",
      }),
      false,
    );
    assert.equal(
      Check(getAction(plugin, "page.share").inputSchema as never, {
        pageId: "page_1",
        email: "not-an-email",
      }),
      false,
    );
    // page.update tolerates a bare id (no minProperties floor).
    assert.equal(
      Check(getAction(plugin, "page.update").inputSchema as never, {
        id: "page_1",
      }),
      true,
    );
  });

  it("creates hosted HTML pages by default", async () => {
    const action = getAction(makeShiftPages(), "page.create");

    mockShift((input, init) => {
      assert.equal(String(input), "https://cloud.shift-labs.ai/v1/pages");
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_test");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        type: "hosted_html",
        visibility: "org",
        slug: "investor-update",
        title: "Investor Update",
        html: "<h1>Q2</h1>",
      });
      return { page: { id: "page_1", slug: "investor-update" } };
    });

    assert.deepEqual(
      await action.execute(
        {
          slug: "investor-update",
          title: "Investor Update",
          html: "<h1>Q2</h1>",
        },
        ctx(),
      ),
      { id: "page_1", slug: "investor-update" },
    );
  });

  it("publishes pages", async () => {
    const action = getAction(makeShiftPages(), "page.publish");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/pages/page_1/publish",
      );
      assert.equal(init?.method, "POST");
      return { page: { id: "page_1", status: "published" } };
    });

    assert.deepEqual(await action.execute({ id: "page_1" }, ctx()), {
      id: "page_1",
      status: "published",
    });
  });

  it("builds render URLs from the fetched page's organization", async () => {
    const action = getAction(makeShiftPages(), "page.renderUrl");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/pages/page_1",
      );
      assert.equal(init?.method, undefined);
      return {
        page: { organizationId: "org_from_api", slug: "investor-update" },
      };
    });

    assert.deepEqual(await action.execute({ pageId: "page_1" }, ctx()), {
      url: "https://cloud.shift-labs.ai/pages/org_from_api/investor-update",
    });
  });
});
