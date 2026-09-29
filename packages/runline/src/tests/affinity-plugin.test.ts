import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import affinity from "../../../runline-plugins/affinity/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build() {
  const { api, resolve } = createPluginAPI("affinity");
  affinity(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected affinity.${name} to be registered`);
  return found;
}

function context(): ActionContext {
  const connection = {
    name: "affinity",
    plugin: "affinity",
    config: { apiKey: "affinity_key" },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

function wire(response: unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(response);
  }) as typeof fetch;
  return urls;
}

describe("affinity search terms", () => {
  it("person.list sends the search term", async () => {
    const urls = wire({ persons: [], next_page_token: null });
    await action("person.list").execute({ term: "ada" }, context());
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).searchParams.get("term"), "ada");
  });

  it("organization.list sends the search term", async () => {
    const urls = wire({ organizations: [], next_page_token: null });
    await action("organization.list").execute({ term: "acme" }, context());
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).searchParams.get("term"), "acme");
  });
});
