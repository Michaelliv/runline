import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import clickup from "../../../runline-plugins/clickup/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build() {
  const { api, resolve } = createPluginAPI("clickup");
  clickup(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected clickup.${name} to be registered`);
  return found;
}

function context(): ActionContext {
  const connection = {
    name: "clickup",
    plugin: "clickup",
    config: { accessToken: "clickup_token" },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

describe("clickup timeEntryTag.remove", () => {
  it("sends the tags to remove in the DELETE body", async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      bodies.push(init?.body ? String(init.body) : "");
      return Response.json({});
    }) as typeof fetch;
    await action("timeEntryTag.remove").execute(
      { teamId: "t1", timeEntryIds: ["e1"], tagNames: ["billable"] },
      context(),
    );
    assert.equal(bodies.length, 1);
    assert.deepEqual(JSON.parse(bodies[0]), {
      time_entry_ids: ["e1"],
      tags: ["billable"],
    });
  });
});
