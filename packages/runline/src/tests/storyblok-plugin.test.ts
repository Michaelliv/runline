import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import storyblok from "../../../runline-plugins/storyblok/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(action: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("storyblok");
  storyblok(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: {
      name: "sb",
      plugin: "storyblok",
      config: { contentToken: "sb_content" },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("storyblok with only a content token", () => {
  it("reads content, and refuses the management API before any request", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url) => {
      seen.push(String(url));
      return Response.json({ stories: [] });
    }) as typeof fetch;
    await run("content.story.list", {});
    await assert.rejects(run("management.story.list", { spaceId: "1" }), {
      code: "invalid_credentials",
    });
    assert.deepEqual(seen, [
      "https://api.storyblok.com/v1/cdn/stories?token=sb_content",
    ]);
  });
});
