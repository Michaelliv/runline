import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import autopilot from "../../../runline-plugins/autopilot/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function action(name: string) {
  const { api, resolve } = createPluginAPI("autopilot");
  autopilot(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, `expected autopilot.${name} to be registered`);
  return found;
}

const ctx: ActionContext = {
  connection: {
    name: "autopilot",
    plugin: "autopilot",
    config: { apiKey: "k" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

function reply(status: number) {
  globalThis.fetch = (async () =>
    new Response(status === 200 ? "{}" : null, { status })) as typeof fetch;
}

describe("autopilot contactList.exists", () => {
  const input = { listId: "l1", contactId: "c1" };

  it("answers from the membership lookup: 200 is in the list, 404 is not", async () => {
    reply(200);
    assert.deepEqual(await action("contactList.exists").execute(input, ctx), {
      exists: true,
    });
    reply(404);
    assert.deepEqual(await action("contactList.exists").execute(input, ctx), {
      exists: false,
    });
  });

  it("reports any other failure instead of answering false", async () => {
    for (const status of [401, 500]) {
      reply(status);
      await assert.rejects(
        Promise.resolve(action("contactList.exists").execute(input, ctx)),
        { message: `autopilot: request failed (HTTP ${status})` },
      );
    }
  });
});
