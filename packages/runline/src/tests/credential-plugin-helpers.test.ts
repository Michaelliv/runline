/**
 * The shared plugin side of the credential broker (`_shared/credentials.ts`):
 * one declaration factory for static keys, one way to turn public config
 * into an HTTPS target, one request path. Every migrated plugin uses these,
 * so a plugin cannot sign differently from its siblings.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  credentialJson,
  credentialRequest,
  hostLabel,
  httpsBase,
  multipartBody,
  pathSegment,
  pathWithin,
  staticCredential,
} from "../../../runline-plugins/_shared/credentials.js";
import { CredentialRegistry } from "../credentials/registry.js";
import type {
  AuthenticatedRequest,
  CredentialBroker,
} from "../credentials/transport.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const example = staticCredential({
  id: "example",
  auth: { kind: "apiKey", header: "X-Api-Key" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/v1/"),
      methods: ["GET", "POST"],
    },
  }),
  probe: { target: "api", path: "me", method: "GET", acceptedStatuses: [200] },
});

function brokered(body: BodyInit | null, status = 200) {
  const requests: AuthenticatedRequest[] = [];
  const broker: CredentialBroker = {
    async request(input) {
      requests.push(input);
      return new Response(body, { status });
    },
    async probe() {
      return { outcome: "unverified" };
    },
  };
  const ctx: ActionContext = {
    connection: { name: "c", plugin: "example", config: {} },
    credentials: broker,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return { ctx, requests };
}

describe("staticCredential", () => {
  it("declares one structured credential field, a method named for its kind, and the flat fields it signs from locally", () => {
    const selection = example({ url: "https://tenant.example.com" });
    assert.equal(selection.method, "apiKey");
    assert.deepEqual(selection.localSecret, { secret: { field: "apiKey" } });
    const method = selection.type.methods.apiKey;
    assert.deepEqual(method.authentication, {
      kind: "apiKey",
      field: "credential",
      header: "X-Api-Key",
    });
    assert.deepEqual(
      method.targets.api.baseUrl,
      "https://tenant.example.com/api/v1/",
    );
    new CredentialRegistry().register(selection.type);
  });

  it("basic declarations name both parts, fixed or from config", () => {
    const basic = staticCredential({
      id: "basic",
      auth: { kind: "basic" },
      local: { username: "email", password: { value: "X" } },
      targets: { api: { baseUrl: "https://api.example/", methods: ["GET"] } },
    })({});
    assert.deepEqual(basic.localSecret, {
      username: { field: "email" },
      password: { value: "X" },
    });
    new CredentialRegistry().register(basic.type);
  });
});

describe("config-derived hosts", () => {
  it("httpsBase keeps an HTTPS origin and path, and appends the API path", () => {
    assert.equal(
      httpsBase("https://jira.example.com", ""),
      "https://jira.example.com/",
    );
    assert.equal(
      httpsBase("https://example.com/sub/", "api/"),
      "https://example.com/sub/api/",
    );
    assert.equal(
      httpsBase("https://example.com:8443", "api/"),
      "https://example.com:8443/api/",
    );
  });

  it("httpsBase refuses anything but a plain HTTPS URL, as invalid_credentials", () => {
    for (const value of [
      undefined,
      "",
      "http://example.com",
      "example.com",
      "https://user:pass@example.com",
      "https://example.com/?q=1",
      "https://example.com/#x",
      "ftp://example.com",
      7,
    ])
      assert.throws(() => httpsBase(value, "api/"), {
        code: "invalid_credentials",
      });
  });

  it("hostLabel accepts one DNS label and nothing that could change the host", () => {
    assert.equal(hostLabel("acme-co"), "acme-co");
    for (const value of [
      "",
      "a.b",
      "a/b",
      "-a",
      "a-",
      "a b",
      "evil.com#",
      7,
      undefined,
    ])
      assert.throws(() => hostLabel(value), { code: "invalid_credentials" });
  });
});

describe("credentialRequest and credentialJson", () => {
  it("build the query, set JSON headers and body, and send through the broker", async () => {
    const { ctx, requests } = brokered(JSON.stringify({ ok: true }));
    const result = await credentialJson(ctx, example, "example", {
      target: "api",
      path: "items",
      method: "POST",
      query: { a: 1, tags: ["x", "y"], skip: undefined, none: null },
      json: { name: "n" },
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(requests, [
      {
        target: "api",
        path: "items?a=1&tags=x&tags=y",
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "n" }),
      },
    ]);
  });

  it("appends to a query already in the path", async () => {
    const { ctx, requests } = brokered("{}");
    await credentialRequest(ctx, example, {
      target: "api",
      path: "items?page=2",
      query: { per: 10 },
    });
    assert.equal(requests[0].path, "items?page=2&per=10");
  });

  it("reports a failure by status alone, never with provider text", async () => {
    const { ctx } = brokered("private-provider-detail", 422);
    await assert.rejects(
      credentialJson(ctx, example, "example", { target: "api", path: "x" }),
      (error: Error) =>
        error.message === "example: request failed (HTTP 422)" &&
        !String(error).includes("private"),
    );
  });

  it("an empty or 204 answer is { success: true }; unparseable JSON is invalid_response", async () => {
    for (const [body, status] of [
      [null, 204],
      ["", 200],
    ] as const) {
      const { ctx } = brokered(body, status);
      assert.deepEqual(
        await credentialJson(ctx, example, "example", {
          target: "api",
          path: "x",
        }),
        { success: true },
      );
    }
    const { ctx } = brokered("not json <private>");
    await assert.rejects(
      credentialJson(ctx, example, "example", { target: "api", path: "x" }),
      { code: "invalid_response" },
    );
  });
});

describe("pathSegment", () => {
  it("encodes a value as exactly one path segment", () => {
    assert.equal(pathSegment("a?c#d e+f"), "a%3Fc%23d%20e%2Bf");
    assert.equal(pathSegment(42), "42");
  });

  it("refuses a value that is not one segment: empty, dot segments, separators", () => {
    for (const value of ["", undefined, null, ".", "..", "a/b", "a\\b"])
      assert.throws(() => pathSegment(value), { code: "request_not_allowed" });
  });
});

describe("pathWithin", () => {
  it("turns an API-returned absolute URL back into a path under the target", () => {
    assert.equal(
      pathWithin(
        "https://api.example/v1/",
        "https://api.example/v1/items?page=2",
      ),
      "items?page=2",
    );
  });

  it("refuses URLs outside the target: other hosts, schemes, ports, prefixes, credentials", () => {
    for (const url of [
      "https://evil.example/v1/items",
      "http://api.example/v1/items",
      "https://api.example:8443/v1/items",
      "https://api.example/v2/items",
      "https://user:pw@api.example/v1/items",
      "https://api.example/v1/items#frag",
      "not a url",
    ])
      assert.throws(() => pathWithin("https://api.example/v1/", url), {
        code: "request_not_allowed",
      });
  });
});

describe("multipartBody", () => {
  it("serializes FormData into buffered bytes with its boundary content type", async () => {
    const form = new FormData();
    form.set("prompt", "a cat");
    form.set(
      "image",
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      "in.png",
    );
    const { body, contentType } = await multipartBody(form);
    assert.ok(body instanceof Uint8Array);
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    const parsed = await new Response(body, {
      headers: { "content-type": contentType },
    }).formData();
    assert.equal(parsed.get("prompt"), "a cat");
    assert.equal((parsed.get("image") as File).size, 3);
  });
});
