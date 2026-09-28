/**
 * The local signer: with no host broker, a plugin signs with its own flat
 * connection config (CLI and env storage). The declaration's `localSecret`
 * names which flat fields, or fixed values, make up the structured secret
 * the transport reads — so the same declaration serves a host that stores
 * the structured field and a CLI that stores `apiKey` flat, and both send
 * identical requests.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as t from "typebox";
import { credentialBroker } from "../../../runline-plugins/_shared/credentialAdapter.js";
import { staticSecretSchema } from "../credentials/registry.js";
import type {
  CredentialDeclaration,
  CredentialSelection,
  SecretPlacement,
} from "../credentials/types.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const bearer: SecretPlacement = {
  in: "header",
  part: "secret",
  name: "Authorization",
  prefix: "Bearer ",
};
const basic: SecretPlacement = {
  in: "basic",
  username: "username",
  password: "password",
};
const header = (prefix: string): SecretPlacement => ({
  in: "header",
  part: "secret",
  name: "Authorization",
  prefix,
});

function declaration(
  placement: SecretPlacement,
  localSecret: CredentialSelection["localSecret"],
): CredentialDeclaration {
  const parts =
    placement.in === "basic" ? ["username", "password"] : ["secret"];
  return () => ({
    type: {
      id: "example",
      methods: {
        key: {
          schema: t.Object(
            { secret: staticSecretSchema(parts) },
            { additionalProperties: false },
          ),
          authentication: {
            kind: "static",
            field: "secret",
            parts,
            placements: [placement],
          },
          targets: {
            api: {
              baseUrl: "https://api.example/v1/",
              methods: ["GET", "POST"],
            },
          },
        },
      },
    },
    method: "key",
    localSecret,
  });
}

function context(config: Record<string, unknown>): ActionContext {
  return {
    connection: { name: "account", plugin: "example", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {
      throw new Error("a static key is never renewed");
    },
  };
}

function capture() {
  const seen: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({
      url: String(url),
      authorization: new Headers(init.headers).get("authorization"),
    });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  return seen;
}

describe("the local signer signs static keys from flat config", () => {
  it("bearer, prefixed header, basic and query keys reach the same wire shape", async () => {
    const cases: Array<
      [CredentialDeclaration, Record<string, unknown>, string, string | null]
    > = [
      [
        declaration(bearer, { secret: { field: "apiKey" } }),
        { apiKey: "sk-1" },
        "https://api.example/v1/items",
        "Bearer sk-1",
      ],
      [
        declaration(header("SSWS "), { secret: { field: "apiToken" } }),
        { apiToken: "okta" },
        "https://api.example/v1/items",
        "SSWS okta",
      ],
      [
        declaration(basic, {
          username: { field: "email" },
          password: { field: "apiToken" },
        }),
        { email: "dana@example.com", apiToken: "t" },
        "https://api.example/v1/items",
        `Basic ${Buffer.from("dana@example.com:t").toString("base64")}`,
      ],
      [
        declaration(basic, {
          username: { value: "api" },
          password: { field: "apiKey" },
        }),
        { apiKey: "key-1" },
        "https://api.example/v1/items",
        `Basic ${Buffer.from("api:key-1").toString("base64")}`,
      ],
      [
        declaration(
          { in: "query", part: "secret", name: "key" },
          { secret: { field: "apiKey" } },
        ),
        { apiKey: "k1" },
        "https://api.example/v1/items?key=k1",
        null,
      ],
    ];
    for (const [declare, config, url, authorization] of cases) {
      const seen = capture();
      const response = await credentialBroker(context(config), declare).request(
        { target: "api", path: "items" },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(seen, [{ url, authorization }]);
    }
  });

  it("joins fields and fixed values into one part, as in {email}/token", async () => {
    const cases: Array<
      [CredentialDeclaration, Record<string, unknown>, string]
    > = [
      [
        declaration(basic, {
          username: { concat: [{ field: "email" }, { value: "/token" }] },
          password: { field: "apiToken" },
        }),
        { email: "dana@example.com", apiToken: "t" },
        `Basic ${Buffer.from("dana@example.com/token:t").toString("base64")}`,
      ],
      [
        declaration(header("token "), {
          secret: {
            concat: [
              { field: "apiKey" },
              { value: ":" },
              { field: "apiSecret" },
            ],
          },
        }),
        { apiKey: "k", apiSecret: "s" },
        "token k:s",
      ],
    ];
    for (const [declare, config, authorization] of cases) {
      const seen = capture();
      await credentialBroker(context(config), declare).request({
        target: "api",
        path: "items",
      });
      assert.equal(seen[0].authorization, authorization);
    }
    const seen = capture();
    await assert.rejects(
      credentialBroker(context({ apiKey: "k" }), cases[1][0]).request({
        target: "api",
        path: "items",
      }),
      { code: "invalid_credentials" },
    );
    assert.deepEqual(seen, []);
  });

  it("a missing or non-string flat field is invalid_credentials before any IO", async () => {
    const declare = declaration(basic, {
      username: { field: "email" },
      password: { field: "apiToken" },
    });
    for (const config of [
      {},
      { email: "dana@example.com" },
      { email: "dana@example.com", apiToken: 7 },
    ]) {
      const seen = capture();
      await assert.rejects(
        credentialBroker(context(config), declare).request({
          target: "api",
          path: "items",
        }),
        { code: "invalid_credentials" },
      );
      assert.deepEqual(seen, []);
    }
  });

  it("a declaration without localSecret cannot sign a static key locally", async () => {
    const seen = capture();
    await assert.rejects(
      credentialBroker(
        context({ apiKey: "sk-1" }),
        declaration(bearer, undefined),
      ).request({ target: "api", path: "items" }),
      { code: "invalid_credentials" },
    );
    assert.deepEqual(seen, []);
  });

  it("refuses a redirect, and the error carries no secret", async () => {
    const declare = declaration(bearer, { secret: { field: "apiKey" } });
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/" },
      })) as unknown as typeof fetch;
    await assert.rejects(
      credentialBroker(context({ apiKey: "sk-1" }), declare).request({
        target: "api",
        path: "items",
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "transport_failed" &&
        !String(error).includes("sk-1"),
    );
  });
});
