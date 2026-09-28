/**
 * The Shift family signs through one declared credential. Its errors carry
 * what an agent needs to correct a call — the service's `code` and the
 * offending `param` — and never the provider's free-text message, which can
 * echo request data back. A Shift service that holds a request open
 * (synchronous OCR extraction, transcription's /await long poll) declares
 * its deadline on the credential's target, and the transport enforces
 * exactly that declaration.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  shiftCredential,
  shiftRequest,
} from "../../../runline-plugins/_shared/shiftCredentials.js";
import { shiftOcrCredential } from "../../../runline-plugins/shiftOcr/src/credentials.js";
import { shiftTranscriptionCredential } from "../../../runline-plugins/shiftTranscription/src/shared.js";
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

describe("Shift requests", () => {
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

function target(declaration: typeof shiftOcrCredential) {
  const { type, method } = declaration({});
  return type.methods[method].targets.api;
}

describe("Shift targets that hold requests open", () => {
  it("declare the long deadline on the target the transport enforces", () => {
    // shiftOcr's synchronous extraction: 5 minutes.
    assert.equal(target(shiftOcrCredential).timeoutMs, 5 * 60_000);
    // shiftTranscription's /await: the 120 s server-held wait plus 60 s.
    assert.equal(target(shiftTranscriptionCredential).timeoutMs, 180_000);
  });

  it("abort a stalled exchange at the target's declared deadline", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(init.signal?.reason),
            );
          },
        }),
      )) as typeof fetch;
    await assert.rejects(
      shiftRequest(
        ctx,
        shiftCredential({ timeoutMs: 20 }),
        "shiftOcr",
        "/v1/services/ocr/extract",
        { method: "POST" },
      ),
      { code: "transport_failed" },
    );
  });

  it("bound the response body at the target's declared ceiling", async () => {
    let cancelled = false;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch;
    await assert.rejects(
      shiftRequest(
        ctx,
        shiftCredential({ maxResponseBytes: 4096 }),
        "shiftOcr",
        "/v1/services/ocr/providers",
      ),
      { code: "response_too_large" },
    );
    assert.ok(cancelled);
  });
});
