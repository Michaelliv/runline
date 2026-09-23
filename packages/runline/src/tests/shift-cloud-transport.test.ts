import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { request } from "../../../runline-plugins/_shared/shiftCloud.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ctx = { connection: { config: { apiKey: "sk_live_test" } } };

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
