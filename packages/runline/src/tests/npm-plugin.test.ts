import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import npm from "../../../runline-plugins/npm/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(
  action: string,
  input: Record<string, unknown>,
  config: Record<string, unknown>,
) {
  const { api, resolve } = createPluginAPI("npm");
  npm(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "npm", plugin: "npm", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

function capture() {
  const seen: Array<{
    url: string;
    method?: string;
    auth: string | null;
    type: string | null;
    body?: string;
  }> = [];
  globalThis.fetch = (async (url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(url),
      method: init?.method,
      auth: headers.get("authorization"),
      type: headers.get("content-type"),
      body: init?.body
        ? new TextDecoder().decode(init.body as Uint8Array)
        : undefined,
    });
    return Response.json({});
  }) as typeof fetch;
  return seen;
}

describe("npm", () => {
  it("reads a scoped package as one encoded segment, unsigned without a token", async () => {
    const seen = capture();
    await run("package.getMetadata", { packageName: "@scope/pkg" }, {});
    assert.deepEqual(
      seen.map((s) => [s.url, s.auth]),
      [["https://registry.npmjs.org/%40scope%2Fpkg/latest", null]],
    );
  });

  it("sets a dist-tag with the version as a JSON string, signed with the token", async () => {
    const seen = capture();
    await run(
      "distTag.update",
      { packageName: "@scope/pkg", tagName: "next", version: "1.2.3" },
      { token: "npm_t" },
    );
    assert.deepEqual(seen, [
      {
        url: "https://registry.npmjs.org/-/package/%40scope%2Fpkg/dist-tags/next",
        method: "PUT",
        auth: "Bearer npm_t",
        type: "application/json",
        body: '"1.2.3"',
      },
    ]);
  });
});
