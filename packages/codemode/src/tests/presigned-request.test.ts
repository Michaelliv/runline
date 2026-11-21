import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { presignedRequest } from "../credentials/http.js";
import { stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("presignedRequest", () => {
  const allowedOrigins = ["https://uploads.example"];
  const answer = () => {
    const seen: RequestInit[] = [];
    stubFetch(async (_url, init) => {
      seen.push(init ?? {});
      return new Response(null, { status: 201 });
    });
    return seen;
  };

  it("sends no credentials and only to an allowed origin", async () => {
    const seen = answer();
    await presignedRequest("https://uploads.example/s?token=t", {
      allowedOrigins,
      fetch: globalThis.fetch,
      method: "PUT",
      body: new Uint8Array([1]),
    });
    assert.equal(seen[0].credentials, "omit");
    assert.equal(seen[0].redirect, "error");
    for (const url of [
      "https://elsewhere.example/s",
      "http://uploads.example/s",
      "https://user:pass@uploads.example/s",
    ])
      await assert.rejects(
        presignedRequest(url, { allowedOrigins, fetch: globalThis.fetch }),
        { code: "request_not_allowed" },
      );
    assert.equal(seen.length, 1);
  });

  it("refuses credentials in headers and a body on a non-PUT", async () => {
    const seen = answer();
    const options = { allowedOrigins, fetch: globalThis.fetch };
    await assert.rejects(
      presignedRequest("https://uploads.example/s", {
        ...options,
        headers: { Authorization: "Bearer t" },
      }),
      { code: "request_not_allowed" },
    );
    await assert.rejects(
      presignedRequest("https://uploads.example/s", {
        ...options,
        body: new Uint8Array([1]),
      }),
      { code: "request_not_allowed" },
    );
    assert.equal(seen.length, 0);
  });
});
