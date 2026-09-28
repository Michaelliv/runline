import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { request } from "../../../runline-plugins/_shared/shiftCloud.js";
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

describe("shared Shift cloud transport", () => {
  it("sends the key with redirects refused and a deadline", async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = init;
      return Response.json({ ok: true });
    }) as typeof fetch;
    assert.deepEqual(await request(ctx, "/v1/crm/accounts"), { ok: true });
    assert.equal(seen?.redirect, "error");
    assert.ok(seen?.signal);
    assert.equal(
      new Headers(seen?.headers).get("authorization"),
      "Bearer sk_live_test",
    );
  });

  it("aborts a stalled exchange at the per-request deadline", async () => {
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
      request(ctx, "/v1/services/ocr/extract", { method: "POST" }, 20),
      /timed out|abort/i,
    );
  });

  it("refuses a redirect instead of handing the key to another host", async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.test" },
      })) as typeof fetch;
    await assert.rejects(
      request(ctx, "/v1/crm/accounts"),
      /Refusing a redirect/,
    );
  });

  it("reports a failure with the service code and param, never its message", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {
          error: {
            type: "invalid_request",
            code: "file_too_large",
            param: "file",
            message: "private-provider-detail",
          },
        },
        { status: 413 },
      )) as typeof fetch;
    await assert.rejects(
      request(ctx, "/v1/services/ocr/extract", { method: "POST" }),
      {
        message:
          "shiftOcr: request failed (HTTP 413 file_too_large, param: file)",
      },
    );
  });

  it("bounds the response body and still returns 204 as undefined", async () => {
    let cancelled = false;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch;
    await assert.rejects(request(ctx, "/v1/crm/accounts"), /exceeds 16 MiB/);
    assert.ok(cancelled);

    globalThis.fetch = (async () =>
      new Response(null, { status: 204 })) as typeof fetch;
    assert.equal(
      await request(ctx, "/v1/crm/accounts/a", { method: "DELETE" }),
      undefined,
    );
  });
});
