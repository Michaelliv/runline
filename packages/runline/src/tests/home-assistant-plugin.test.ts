import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import homeAssistant from "../../../runline-plugins/homeAssistant/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build() {
  const { api, resolve } = createPluginAPI("homeAssistant");
  homeAssistant(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected homeAssistant.${name} to be registered`);
  return found;
}

function context(): ActionContext {
  const connection = {
    name: "homeAssistant",
    plugin: "homeAssistant",
    config: { host: "ha.example.com", ssl: true, accessToken: "hass_token" },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

describe("homeAssistant template.render", () => {
  it("returns the rendered text /api/template answers with", async () => {
    const rendered = "The kitchen light is on.";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(rendered, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }) as typeof fetch;

    const result = await action("template.render").execute(
      { template: "The kitchen light is {{ states('light.kitchen') }}." },
      context(),
    );

    assert.deepEqual(urls, ["https://ha.example.com:8123/api/template"]);
    assert.equal(result, rendered);
  });
});
