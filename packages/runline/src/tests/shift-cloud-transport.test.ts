/**
 * Shift requests that outlive the transport defaults. A Shift service that
 * holds a request open (synchronous OCR extraction, transcription's /await
 * long poll) declares the deadline on its credential's target, and the
 * transport enforces exactly that declaration — the deadline and the
 * response ceiling reach sendResource as the target's own limits.
 *
 * Redirect refusal, dropped provider text, and 204 answering no value are
 * covered by the plugins' credential fixtures and shift-credentials.test.ts.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  shiftCredential,
  shiftRequest,
} from "../../../runline-plugins/_shared/shiftCredentials.js";
import { shiftOcrCredential } from "../../../runline-plugins/shiftOcr/src/credentials.js";
import { shiftTranscriptionCredential } from "../../../runline-plugins/shiftTranscription/src/shared.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ctx: ActionContext = {
  connection: {
    name: "shiftOcr",
    plugin: "shiftOcr",
    config: { apiKey: "sk_live_test" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

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
