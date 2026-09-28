/**
 * The Shift family signs through one declared credential. Its errors carry
 * what an agent needs to correct a call — the service's `code` and the
 * offending `param` — and never the provider's free-text message, which can
 * echo request data back.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  shiftCredential,
  shiftRequest,
} from "../../../runline-plugins/_shared/shiftCredentials.js";
import shiftWork from "../../../runline-plugins/shiftWork/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function action(name: string) {
  const { api, resolve } = createPluginAPI("test");
  shiftWork(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found);
  return found;
}

const ctx: ActionContext = {
  connection: {
    name: "shiftWork",
    plugin: "shiftWork",
    config: { apiKey: "shift_key" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

function reply(response: Response) {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

describe("Shift errors", () => {
  it("keep the service code and param, never the message", async () => {
    reply(
      Response.json(
        {
          error: {
            type: "invalid_request",
            code: "unknown_field",
            param: "fields.tier",
            message: "private-provider-detail",
          },
        },
        { status: 422 },
      ),
    );
    await assert.rejects(
      Promise.resolve(action("issue.get").execute({ id: "i1" }, ctx)),
      {
        message:
          "shiftWork: request failed (HTTP 422 unknown_field, param: fields.tier)",
      },
    );
  });

  it("fall back to the type, and drop identifiers that are not plain names", async () => {
    reply(
      Response.json(
        { error: { type: "not_found", param: "id <script>" } },
        { status: 404 },
      ),
    );
    await assert.rejects(
      Promise.resolve(action("issue.get").execute({ id: "i1" }, ctx)),
      { message: "shiftWork: request failed (HTTP 404 not_found)" },
    );
    reply(new Response("private-provider-detail", { status: 500 }));
    await assert.rejects(
      Promise.resolve(action("issue.get").execute({ id: "i1" }, ctx)),
      { message: "shiftWork: request failed (HTTP 500)" },
    );
  });

  it("answer 204 with no value, as the Shift API contract has it", async () => {
    reply(new Response(null, { status: 204 }));
    assert.equal(
      await shiftRequest(ctx, shiftCredential(), "shiftWork", "/v1/issues/i1", {
        method: "DELETE",
      }),
      undefined,
    );
  });

  it("refuse a route outside the Shift API's /v1 surface before any IO", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({});
    }) as unknown as typeof fetch;
    for (const path of [
      "/pages/org/slug",
      "v1/issues",
      "https://evil.example/v1/x",
    ])
      await assert.rejects(
        shiftRequest(ctx, shiftCredential(), "shiftWork", path),
        { code: "request_not_allowed" },
      );
    assert.equal(calls, 0);
  });
});
