import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import * as t from "typebox";
import { AuthError } from "../auth/errors.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import {
  CredentialRegistry,
  OAuthGrantSchema,
  staticSecretSchema,
} from "../credentials/registry.js";
import {
  type AuthenticatedRequest,
  CredentialTransport,
} from "../credentials/transport.js";
import type {
  CredentialAuthentication,
  CredentialBinding,
  CredentialMethod,
  CredentialType,
  OAuthGrant,
} from "../credentials/types.js";

type Placements = Extract<
  CredentialAuthentication,
  { kind: "static" }
>["placements"];

/** A static secret of named parts in field `key`, placed as declared. */
function placed(
  def: CredentialType,
  parts: string[],
  placements: Placements,
): void {
  def.methods.selected.schema = t.Object(
    { key: staticSecretSchema(parts) },
    { additionalProperties: false },
  );
  def.methods.selected.authentication = {
    kind: "static",
    field: "key",
    parts,
    placements,
  };
}

const basic: Placements = [
  { in: "basic", username: "username", password: "password" },
];

const initial: OAuthGrant = {
  tokens: { accessToken: "old", refreshToken: "r1" },
  revision: "r1",
};
function definition(
  kind: "oauth2" | "bearer" | "apiKey" = "oauth2",
): CredentialType {
  const method: CredentialMethod = {
    schema: t.Object(
      { grant: t.Optional(OAuthGrantSchema) },
      { additionalProperties: false },
    ),
    authentication: {
      kind: "oauth2",
      field: "grant",
      renewal: "refresh",
      definition: {
        id: "example.oauth",
        provider: "example",
        refresh: {
          url: "https://auth.example/token",
          clientAuthentication: "none",
        },
        clientCredentials: {
          url: "https://auth.example/token",
          clientAuthentication: "client_secret_post",
        },
      },
    },
    targets: {
      api: {
        baseUrl: "https://api.example/v1/",
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
        idempotency: { header: "Idempotency-Key", methods: ["POST"] },
      },
    },
    probe: {
      target: "api",
      path: "me",
      method: "GET",
      acceptedStatuses: [200],
    },
  };
  const def: CredentialType = { id: "example", methods: { selected: method } };
  if (kind === "bearer")
    placed(
      def,
      ["secret"],
      [
        {
          in: "header",
          part: "secret",
          name: "Authorization",
          prefix: "Bearer ",
        },
      ],
    );
  if (kind === "apiKey")
    placed(
      def,
      ["secret"],
      [{ in: "header", part: "secret", name: "X-Api-Key" }],
    );
  return def;
}
function mock(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (url, init) =>
    handler(String(url), init ?? {})) as typeof fetch;
}
async function harness(
  fetch: typeof globalThis.fetch,
  config: Record<string, unknown> = { grant: initial },
  def = definition(),
) {
  const registry = new CredentialRegistry();
  registry.register(def);
  const store = new MemoryConnectionProvider([
    { name: "account", plugin: "example", config },
  ]);
  const binding: CredentialBinding = {
    type: "example",
    method: "selected",
    identity: { name: "account", plugin: "example" },
    connection: await store.resolve({ plugin: "example" }),
    application: { clientId: "client", clientSecret: "secret" },
  };
  return {
    registry,
    store,
    binding,
    transport: new CredentialTransport(registry, { fetch }),
  };
}
const request: AuthenticatedRequest = { target: "api", path: "items" };
const errorCode = (code: string) => (error: unknown) =>
  error instanceof AuthError && error.code === code;

describe("constrained credential transport", () => {
  it("injects API keys and bearer tokens from their stored secret without query credentials or ambient cookies", async () => {
    for (const kind of ["apiKey", "bearer"] as const) {
      const h = await harness(
        mock((url, init) => {
          assert.equal(url, "https://api.example/v1/items");
          assert.equal(init.redirect, "error");
          assert.equal(init.credentials, "omit");
          const headers = new Headers(init.headers);
          assert.equal(
            headers.get(kind === "apiKey" ? "x-api-key" : "authorization"),
            kind === "apiKey" ? "private" : "Bearer private",
          );
          return Response.json({ ok: true });
        }),
        { key: { secret: "private" } },
        definition(kind),
      );
      assert.deepEqual(
        await (await h.transport.request(h.binding, request)).json(),
        { ok: true },
      );
    }
  });

  it("prefixes an API key only with its declared scheme, in its declared header", async () => {
    for (const prefix of ["SSWS ", "Token token=", "api-key ", "Bot "]) {
      const def = definition("apiKey");
      placed(
        def,
        ["secret"],
        [{ in: "header", part: "secret", name: "Authorization", prefix }],
      );
      const h = await harness(
        mock((_url, init) => {
          assert.equal(
            new Headers(init.headers).get("authorization"),
            `${prefix}private`,
          );
          return Response.json({});
        }),
        { key: { secret: "private" } },
        def,
      );
      assert.equal((await h.transport.request(h.binding, request)).status, 200);
    }
  });

  it("signs HTTP Basic from a stored username and password, either of which may be empty", async () => {
    for (const [username, password] of [
      ["dana@example.com", "token"],
      ["sk_live_1", ""],
      ["", "token"],
      ["user", "pass word:with colon"],
    ]) {
      const def = definition("bearer");
      placed(def, ["username", "password"], basic);
      const h = await harness(
        mock((_url, init) => {
          assert.equal(
            new Headers(init.headers).get("authorization"),
            `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          );
          return Response.json({});
        }),
        { key: { username, password } },
        def,
      );
      assert.equal((await h.transport.request(h.binding, request)).status, 200);
    }
  });

  it("refuses Basic credentials that cannot be encoded unambiguously, before any IO", async () => {
    for (const key of [
      { username: "has:colon", password: "p" },
      { username: "", password: "" },
      { username: "line\nbreak", password: "p" },
      { username: "u", password: "tab\there" },
      { username: "danä", password: "p" },
      { username: "u" },
      "u:p",
    ]) {
      let calls = 0;
      const def = definition("bearer");
      placed(def, ["username", "password"], basic);
      const h = await harness(
        mock(() => {
          calls++;
          return Response.json({});
        }),
        { key },
        def,
      );
      await assert.rejects(
        h.transport.request(h.binding, request),
        (error: unknown) =>
          error instanceof AuthError &&
          error.code === "invalid_credentials" &&
          !String(error).includes("colon"),
      );
      assert.equal(calls, 0);
    }
  });

  it("adds a declared query key itself, beside the caller's own parameters, with no auth header", async () => {
    const def = definition("bearer");
    placed(def, ["secret"], [{ in: "query", part: "secret", name: "api_key" }]);
    const seen: string[] = [];
    const h = await harness(
      mock((url, init) => {
        seen.push(url);
        assert.equal(new Headers(init.headers).has("authorization"), false);
        return Response.json({});
      }),
      { key: { secret: "pri&vate=1" } },
      def,
    );
    await h.transport.request(h.binding, { ...request, path: "items?q=a" });
    await h.transport.probe(h.binding);
    assert.deepEqual(
      seen.map((url) => Object.fromEntries(new URL(url).searchParams)),
      [{ q: "a", api_key: "pri&vate=1" }, { api_key: "pri&vate=1" }],
    );
  });

  it("refuses a caller-supplied copy of the declared query key, in any case, before reading credentials", async () => {
    const def = definition("bearer");
    placed(def, ["secret"], [{ in: "query", part: "secret", name: "hapikey" }]);
    let reads = 0;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: { secret: "private" } },
      def,
    );
    h.binding.connection.read = async () => {
      reads++;
      throw new Error("private");
    };
    for (const path of [
      "items?hapikey=evil",
      "items?HapiKey=evil",
      "items?api_key=x",
    ])
      await assert.rejects(
        h.transport.request(h.binding, { ...request, path }),
        errorCode("request_not_allowed"),
      );
    assert.equal(reads, 0);
    assert.equal(calls, 0);
  });

  it("places each part of a several-part secret, and one part in two places", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["key", "token"],
      [
        { in: "query", part: "key", name: "key" },
        { in: "query", part: "token", name: "token" },
        { in: "header", part: "token", name: "X-Token" },
      ],
    );
    const seen: Array<{ query: Record<string, string>; token: string | null }> =
      [];
    const h = await harness(
      mock((url, init) => {
        seen.push({
          query: Object.fromEntries(new URL(url).searchParams),
          token: new Headers(init.headers).get("x-token"),
        });
        return Response.json({});
      }),
      { key: { key: "k1", token: "t1" } },
      def,
    );
    await h.transport.request(h.binding, { ...request, path: "items?q=a" });
    assert.deepEqual(seen, [
      { query: { q: "a", key: "k1", token: "t1" }, token: "t1" },
    ]);
    for (const input of [
      { ...request, path: "items?TOKEN=evil" },
      { ...request, headers: { "X-Token": "evil" } },
    ])
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(seen.length, 1);
  });

  it("adds a body part to a JSON object or a form, and to the query when the request has no body", async () => {
    const def = definition("bearer");
    placed(def, ["key"], [{ in: "body", part: "key", name: "api_key" }]);
    const seen: Array<{ url: string; body?: string; type: string | null }> = [];
    const h = await harness(
      mock((url, init) => {
        seen.push({
          url,
          body: init.body
            ? Buffer.from(init.body as Uint8Array).toString()
            : undefined,
          type: new Headers(init.headers).get("content-type"),
        });
        return Response.json({});
      }),
      { key: { key: "k&1" } },
      def,
    );
    await h.transport.request(h.binding, {
      ...request,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    await h.transport.request(h.binding, {
      ...request,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    await h.transport.request(h.binding, { ...request, path: "items?q=a" });
    assert.deepEqual(JSON.parse(seen[0].body ?? ""), { a: 1, api_key: "k&1" });
    assert.equal(seen[0].url, "https://api.example/v1/items");
    assert.equal(seen[1].body, "a=1&api_key=k%261");
    assert.equal(seen[1].url, "https://api.example/v1/items");
    assert.equal(seen[2].body, undefined);
    assert.deepEqual(Object.fromEntries(new URL(seen[2].url).searchParams), {
      q: "a",
      api_key: "k&1",
    });
  });

  it("refuses a caller copy of a body part, or a body it cannot place it in, before reading credentials", async () => {
    const def = definition("bearer");
    placed(def, ["key"], [{ in: "body", part: "key", name: "token" }]);
    let reads = 0;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: { key: "k" } },
      def,
    );
    h.binding.connection.read = async () => {
      reads++;
      throw new Error("private");
    };
    const json = { "Content-Type": "application/json" };
    const form = { "Content-Type": "application/x-www-form-urlencoded" };
    for (const input of [
      { ...request, path: "items?TOKEN=evil" },
      {
        ...request,
        method: "POST" as const,
        headers: json,
        body: '{"token":"evil"}',
      },
      {
        ...request,
        method: "POST" as const,
        headers: json,
        body: '{"TOKEN":"evil"}',
      },
      { ...request, method: "POST" as const, headers: json, body: "[1]" },
      { ...request, method: "POST" as const, headers: json, body: "not json" },
      {
        ...request,
        method: "POST" as const,
        headers: form,
        body: "token=evil",
      },
      {
        ...request,
        method: "POST" as const,
        headers: { "Content-Type": "text/plain" },
        body: "x",
      },
      { ...request, method: "POST" as const, body: "x" },
    ])
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(reads, 0);
    assert.equal(calls, 0);
  });

  it("inserts a path part as the first segment beneath the base, and may place the same part in Basic too", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["account", "token"],
      [
        { in: "path", part: "account", prefix: "bot" },
        { in: "basic", username: "account", password: "token" },
      ],
    );
    const seen: Array<{ url: string; auth: string | null }> = [];
    const h = await harness(
      mock((url, init) => {
        seen.push({
          url,
          auth: new Headers(init.headers).get("authorization"),
        });
        return Response.json({});
      }),
      { key: { account: "AC1@x", token: "t" } },
      def,
    );
    await h.transport.request(h.binding, { ...request, path: "items?q=a" });
    await h.transport.request(h.binding, { ...request, path: "" });
    assert.deepEqual(
      seen.map((s) => s.url),
      [
        "https://api.example/v1/botAC1@x/items?q=a",
        "https://api.example/v1/botAC1@x",
      ],
    );
    assert.equal(
      seen[0].auth,
      `Basic ${Buffer.from("AC1@x:t").toString("base64")}`,
    );
    // A colon stays literal in a segment, as in Telegram's bot<id>:<token>.
    const telegram = definition("bearer");
    placed(telegram, ["token"], [{ in: "path", part: "token", prefix: "bot" }]);
    const t = await harness(
      mock((url) => {
        seen.push({ url, auth: null });
        return Response.json({});
      }),
      { key: { token: "123:ABC" } },
      telegram,
    );
    await t.transport.request(t.binding, { ...request, path: "getMe" });
    assert.equal(seen.at(-1)?.url, "https://api.example/v1/bot123:ABC/getMe");
  });

  it("refuses a path part that is not one segment, before any IO", async () => {
    for (const account of ["a/b", "..", ".", "a?b", "a#b"]) {
      const def = definition("bearer");
      placed(def, ["account"], [{ in: "path", part: "account" }]);
      let calls = 0;
      const h = await harness(
        mock(() => {
          calls++;
          return Response.json({});
        }),
        { key: { account } },
        def,
      );
      await assert.rejects(
        h.transport.request(h.binding, request),
        errorCode("invalid_credentials"),
      );
      assert.equal(calls, 0);
    }
  });

  it("sends an unsigned method's requests with no credential, still held to its targets", async () => {
    const def = definition("bearer");
    def.methods.selected.schema = t.Object({}, { additionalProperties: false });
    def.methods.selected.authentication = { kind: "none" };
    const seen: Array<{ url: string; auth: string | null }> = [];
    const h = await harness(
      mock((url, init) => {
        seen.push({
          url,
          auth: new Headers(init.headers).get("authorization"),
        });
        return Response.json({});
      }),
      {},
      def,
    );
    await h.transport.request(h.binding, request);
    assert.deepEqual(seen, [
      { url: "https://api.example/v1/items", auth: null },
    ]);
    await assert.rejects(
      h.transport.request(h.binding, {
        ...request,
        path: "https://evil.example/",
      }),
      errorCode("request_not_allowed"),
    );
  });

  it("allows an encoded slash inside a segment only on a target that opts in, and never a dot or empty piece", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.slashed = {
      baseUrl: "https://api.example/v4/",
      methods: ["GET"],
      encodedSlashes: true,
    };
    const seen: string[] = [];
    const h = await harness(
      mock((url) => {
        seen.push(url);
        return Response.json({});
      }),
      { key: { secret: "k" } },
      def,
    );
    await h.transport.request(h.binding, {
      target: "slashed",
      path: "projects/group%2Fsub%2Fproj/issues",
    });
    assert.deepEqual(seen, [
      "https://api.example/v4/projects/group%2Fsub%2Fproj/issues",
    ]);
    for (const input of [
      { target: "api", path: "projects/group%2Fproj" },
      { target: "slashed", path: "projects/a%2F..%2Fadmin" },
      { target: "slashed", path: "projects/..%2Fadmin" },
      { target: "slashed", path: "projects/a%2F%2Fb" },
      { target: "slashed", path: "projects/a%2F" },
      { target: "slashed", path: "projects/a%2F." },
      { target: "slashed", path: "projects/a%252Fb" },
      { target: "slashed", path: "projects/a%5Cb" },
    ])
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(seen.length, 1);
  });

  it("sends WebDAV methods, with COPY and MOVE given a Destination beneath the same target", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.dav = {
      baseUrl: "https://api.example/dav/",
      methods: ["MKCOL", "COPY", "MOVE", "DELETE"],
    };
    const seen: Array<{
      url: string;
      method?: string;
      destination: string | null;
    }> = [];
    const h = await harness(
      mock((url, init) => {
        seen.push({
          url,
          method: init.method,
          destination: new Headers(init.headers).get("destination"),
        });
        return new Response(null, { status: 201 });
      }),
      { key: { secret: "k" } },
      def,
    );
    await h.transport.request(h.binding, {
      target: "dav",
      path: "a%20b",
      method: "MKCOL",
    });
    await h.transport.request(h.binding, {
      target: "dav",
      path: "a%20b/x.txt",
      method: "MOVE",
      destination: "c/y.txt",
    });
    assert.deepEqual(seen, [
      {
        url: "https://api.example/dav/a%20b",
        method: "MKCOL",
        destination: null,
      },
      {
        url: "https://api.example/dav/a%20b/x.txt",
        method: "MOVE",
        destination: "https://api.example/dav/c/y.txt",
      },
    ]);
  });

  it("refuses a destination outside the target, with a query, on another method, or set by the caller, before reading credentials", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.dav = {
      baseUrl: "https://api.example/dav/",
      methods: ["COPY", "DELETE"],
    };
    let reads = 0;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: { secret: "k" } },
      def,
    );
    h.binding.connection.read = async () => {
      reads++;
      throw new Error("private");
    };
    const copy = { target: "dav", path: "a", method: "COPY" as const };
    for (const input of [
      ...[
        "../outside",
        "/abs",
        "https://evil.example/dav/b",
        "%2e%2e/b",
        "b?x=1",
        "b#f",
        "",
      ].map((destination) => ({ ...copy, destination })),
      { ...copy },
      { target: "dav", path: "a", method: "DELETE" as const, destination: "b" },
      { ...request, destination: "b" },
      { ...copy, destination: "b", headers: { Destination: "https://evil/" } },
      { target: "dav", path: "a", method: "MOVE" as const, destination: "b" },
    ])
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(reads, 0);
    assert.equal(calls, 0);
  });

  it("signs a short-lived HS256 JWT from a key id and hex secret, per request", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["adminKey"],
      [
        {
          in: "jwt",
          part: "adminKey",
          name: "Authorization",
          prefix: "Ghost ",
          audience: "/admin/",
        },
      ],
    );
    const tokens: string[] = [];
    const h = await harness(
      mock((_url, init) => {
        tokens.push(new Headers(init.headers).get("authorization") ?? "");
        return Response.json({});
      }),
      { key: { adminKey: "kid123:00ff10" } },
      def,
    );
    const before = Math.floor(Date.now() / 1000);
    await h.transport.request(h.binding, request);
    assert.match(tokens[0], /^Ghost [\w-]+\.[\w-]+\.[\w-]+$/);
    const [head, body, signature] = tokens[0].slice("Ghost ".length).split(".");
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part, "base64url").toString());
    assert.deepEqual(decode(head), { alg: "HS256", typ: "JWT", kid: "kid123" });
    const claims = decode(body);
    assert.equal(claims.aud, "/admin/");
    assert.ok(claims.iat >= before && claims.iat <= before + 5);
    assert.equal(claims.exp, claims.iat + 300);
    assert.equal(
      signature,
      createHmac("sha256", Buffer.from("00ff10", "hex"))
        .update(`${head}.${body}`)
        .digest("base64url"),
    );
  });

  it("refuses a JWT key that is not a key id and hex secret, before any IO", async () => {
    for (const adminKey of [
      "nocolon",
      "kid:nothex",
      "kid:abc",
      ":00ff",
      "kid:",
    ]) {
      const def = definition("bearer");
      placed(
        def,
        ["adminKey"],
        [
          {
            in: "jwt",
            part: "adminKey",
            name: "Authorization",
            audience: "/a/",
          },
        ],
      );
      let calls = 0;
      const h = await harness(
        mock(() => {
          calls++;
          return Response.json({});
        }),
        { key: { adminKey } },
        def,
      );
      await assert.rejects(
        h.transport.request(h.binding, request),
        errorCode("invalid_credentials"),
      );
      assert.equal(calls, 0);
    }
  });

  it("signs the query as sent, after every other placement, with an HMAC in a header", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["apiId", "apiKey", "extra"],
      [
        { in: "header", part: "apiId", name: "api-auth-id" },
        { in: "querySignature", part: "apiKey", name: "api-auth-signature" },
        { in: "query", part: "extra", name: "extra" },
      ],
    );
    const seen: Array<{ url: string; id: string | null; sig: string | null }> =
      [];
    const h = await harness(
      mock((url, init) => {
        const headers = new Headers(init.headers);
        seen.push({
          url,
          id: headers.get("api-auth-id"),
          sig: headers.get("api-auth-signature"),
        });
        return Response.json({});
      }),
      { key: { apiId: "id1", apiKey: "k1", extra: "x" } },
      def,
    );
    await h.transport.request(h.binding, { ...request, path: "items?b=2&a=1" });
    await h.transport.request(h.binding, { ...request, path: "items" });
    const hmac = (query: string) =>
      createHmac("sha256", "k1").update(query).digest("base64");
    assert.deepEqual(seen, [
      {
        url: "https://api.example/v1/items?b=2&a=1&extra=x",
        id: "id1",
        sig: hmac("b=2&a=1&extra=x"),
      },
      {
        url: "https://api.example/v1/items?extra=x",
        id: "id1",
        sig: hmac("extra=x"),
      },
    ]);
  });

  it("fills a JSON body's null slot at a pointer with a part", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["password"],
      [{ in: "jsonPointer", part: "password", pointer: "/params/args/2" }],
    );
    const bodies: unknown[] = [];
    const h = await harness(
      mock((_url, init) => {
        bodies.push(
          JSON.parse(Buffer.from(init.body as Uint8Array).toString()),
        );
        return Response.json({});
      }),
      { key: { password: "pw" } },
      def,
    );
    await h.transport.request(h.binding, {
      ...request,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "call",
        params: { args: ["db", 7, null, "res.partner"] },
      }),
    });
    assert.deepEqual(bodies, [
      { method: "call", params: { args: ["db", 7, "pw", "res.partner"] } },
    ]);
  });

  it("refuses a pointer slot the caller filled, one that does not resolve, or a request with no JSON body, before reading credentials", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["password"],
      [{ in: "jsonPointer", part: "password", pointer: "/params/args/2" }],
    );
    let reads = 0;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: { password: "pw" } },
      def,
    );
    h.binding.connection.read = async () => {
      reads++;
      throw new Error("private");
    };
    const json = { "Content-Type": "application/json" };
    for (const input of [
      { ...request },
      { ...request, method: "POST" as const, headers: json, body: "not json" },
      {
        ...request,
        method: "POST" as const,
        headers: json,
        body: JSON.stringify({ params: { args: ["db", 7, "evil"] } }),
      },
      {
        ...request,
        method: "POST" as const,
        headers: json,
        body: JSON.stringify({ params: { args: ["db", 7] } }),
      },
      {
        ...request,
        method: "POST" as const,
        headers: json,
        body: JSON.stringify({ params: {} }),
      },
      {
        ...request,
        method: "POST" as const,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "params=1",
      },
    ])
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(reads, 0);
    assert.equal(calls, 0);
  });

  it("places a part only on the targets it is scoped to, so two parts may share a header across targets", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.client = {
      baseUrl: "https://api.example/v1/",
      methods: ["GET"],
    };
    placed(
      def,
      ["app", "client"],
      [
        { in: "header", part: "app", name: "X-Key", targets: ["api"] },
        { in: "header", part: "client", name: "X-Key", targets: ["client"] },
      ],
    );
    const seen: Array<string | null> = [];
    const h = await harness(
      mock((_url, init) => {
        seen.push(new Headers(init.headers).get("x-key"));
        return Response.json({});
      }),
      { key: { app: "a1", client: "c1" } },
      def,
    );
    await h.transport.request(h.binding, request);
    await h.transport.request(h.binding, { target: "client", path: "x" });
    assert.deepEqual(seen, ["a1", "c1"]);
  });

  it("refuses a target whose optional part the connection lacks, and signs the others", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.management = {
      baseUrl: "https://api.example/v2/",
      methods: ["GET"],
    };
    def.methods.selected.schema = t.Object(
      {
        key: staticSecretSchema(
          ["content", "management"],
          ["content", "management"],
        ),
      },
      { additionalProperties: false },
    );
    def.methods.selected.authentication = {
      kind: "static",
      field: "key",
      parts: ["content", "management"],
      optionalParts: ["content", "management"],
      placements: [
        { in: "query", part: "content", name: "token", targets: ["api"] },
        {
          in: "header",
          part: "management",
          name: "Authorization",
          targets: ["management"],
        },
      ],
    };
    const seen: string[] = [];
    const h = await harness(
      mock((url) => {
        seen.push(url);
        return Response.json({});
      }),
      { key: { content: "ct" } },
      def,
    );
    await h.transport.request(h.binding, request);
    await assert.rejects(
      h.transport.request(h.binding, { target: "management", path: "x" }),
      errorCode("invalid_credentials"),
    );
    assert.deepEqual(seen, ["https://api.example/v1/items?token=ct"]);
  });

  it("refuses an empty part in a header or query placement, before any IO", async () => {
    const def = definition("bearer");
    placed(
      def,
      ["key", "token"],
      [
        { in: "query", part: "key", name: "key" },
        { in: "query", part: "token", name: "token" },
      ],
    );
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: { key: "k1", token: "" } },
      def,
    );
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("invalid_credentials"),
    );
    assert.equal(calls, 0);
  });

  it("refuses a static secret stored flat instead of in its structured field", async () => {
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
      { key: "private" },
      definition("bearer"),
    );
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("invalid_credentials"),
    );
    assert.equal(calls, 0);
  });

  it("rejects escape paths, header overrides, methods and single-use bodies before reading credentials", async () => {
    let reads = 0;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
    );
    h.binding.connection.read = async () => {
      reads++;
      throw new Error("private");
    };
    const bad: AuthenticatedRequest[] = [
      ...[
        "https://evil.example/",
        "//evil.example/",
        "/outside",
        "../outside",
        "%2e%2e/outside",
        "%252e%252e/outside",
        "a/%2foutside",
        "a\\b",
        "items#fragment",
        "items?ACCESS_TOKEN=evil",
        "items\n",
        "https:evil",
        "%00",
      ].map((path) => ({ ...request, path })),
      { ...request, target: "toString" },
      ...[
        "Authorization",
        "X-Api-Key",
        "Cookie",
        "Host",
        "Content-Length",
        "X-HTTP-Method-Override",
        "Idempotency-Key",
      ].map((header) => ({ ...request, headers: { [header]: "evil" } })),
      { ...request, method: "OPTIONS" as "GET" },
      { ...request, body: "invalid-get-body" },
      {
        ...request,
        method: "POST",
        body: new ReadableStream() as unknown as string,
      },
      { ...request, method: "PUT", idempotencyKey: "not-declared" },
    ];
    for (const input of bad)
      await assert.rejects(
        h.transport.request(h.binding, input),
        errorCode("request_not_allowed"),
      );
    assert.equal(reads, 0);
    assert.equal(calls, 0);
  });

  it("reuses unknown expiry and refreshes once on rejection, preserving rotated grant durability", async () => {
    const seen: string[] = [];
    const h = await harness(
      mock((url, init) => {
        if (url.includes("auth.example")) {
          seen.push("refresh");
          assert.equal(
            new URLSearchParams(String(init.body)).get("refresh_token"),
            "r1",
          );
          return Response.json({ access_token: "new", refresh_token: "r2" });
        }
        const token = new Headers(init.headers).get("authorization") ?? "";
        seen.push(token);
        if (token === "Bearer old")
          return new Response("private rejection", { status: 401 });
        assert.equal(
          (h.store.list()[0].config.grant as OAuthGrant).tokens.refreshToken,
          "r2",
        );
        return Response.json({ ok: true });
      }),
    );
    assert.equal((await h.transport.request(h.binding, request)).status, 200);
    assert.deepEqual(seen, ["Bearer old", "refresh", "Bearer new"]);
    assert.notEqual(
      (h.store.list()[0].config.grant as OAuthGrant).revision,
      "r1",
    );
  });

  it("serializes stale rejections by revision even when the provider repeats access tokens", async () => {
    let renewals = 0;
    let firsts = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = mock(async (url) => {
      if (url.includes("auth.example")) {
        renewals++;
        await new Promise((r) => setTimeout(r, 5));
        return Response.json({
          access_token: "old",
          refresh_token: "r2",
          expires_in: 3600,
        });
      }
      if (firsts < 3) {
        firsts++;
        if (firsts === 3) release();
        await barrier;
        return new Response(null, { status: 401 });
      }
      return Response.json({ ok: true });
    });
    const h = await harness(fetch);
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        new CredentialTransport(h.registry, { fetch }).request(
          h.binding,
          request,
        ),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200],
    );
    assert.equal(renewals, 1);
  });

  it("coordinates proactive refresh and clears stale expiry when renewal omits it", async () => {
    let renewals = 0;
    const h = await harness(
      mock(async (url) => {
        if (url.includes("auth.example")) {
          renewals++;
          await new Promise((r) => setTimeout(r, 5));
          return Response.json({ access_token: "new" });
        }
        return Response.json({});
      }),
      { grant: { ...initial, tokens: { ...initial.tokens, expiresAt: 1 } } },
    );
    await Promise.all(
      [1, 2, 3].map(() => h.transport.request(h.binding, request)),
    );
    assert.equal(renewals, 1);
    assert.equal(
      (h.store.list()[0].config.grant as OAuthGrant).tokens.expiresAt,
      undefined,
    );
    assert.equal(
      (h.store.list()[0].config.grant as OAuthGrant).tokens.refreshToken,
      "r1",
    );
  });

  it("uses explicit client credentials for initial acquisition under the same ownership", async () => {
    const def = definition();
    const auth = def.methods.selected.authentication;
    assert.equal(auth.kind, "oauth2");
    if (auth.kind !== "oauth2") throw new Error();
    auth.renewal = "clientCredentials";
    let renewals = 0;
    const h = await harness(
      mock((url, init) => {
        if (url.includes("auth.example")) {
          renewals++;
          assert.equal(
            new URLSearchParams(String(init.body)).get("grant_type"),
            "client_credentials",
          );
          return Response.json({ access_token: "app", expires_in: 3600 });
        }
        return Response.json({});
      }),
      {},
      def,
    );
    await Promise.all(
      [1, 2, 3].map(() => h.transport.request(h.binding, request)),
    );
    assert.equal(renewals, 1);
  });

  it("never retries unsafe writes, 403 by default, 429, 5xx, or explicitly disabled retries", async () => {
    for (const spec of [
      { method: "POST", status: 401 },
      { method: "PUT", status: 401 },
      { method: "PATCH", status: 401 },
      { method: "DELETE", status: 401 },
      { method: "GET", status: 403 },
      { method: "GET", status: 429 },
      { method: "GET", status: 500 },
      { method: "GET", status: 401, retry: "never" },
    ] as const) {
      let calls = 0;
      const h = await harness(
        mock(() => {
          calls++;
          return new Response(null, { status: spec.status });
        }),
      );
      const result = await h.transport.request(h.binding, {
        ...request,
        method: spec.method,
        retry: "retry" in spec ? spec.retry : undefined,
      });
      assert.equal(result.status, spec.status);
      assert.equal(calls, 1);
    }
  });

  it("replays declared idempotent writes once with identical pinned bytes and key", async () => {
    const bodies: string[] = [];
    const keys: string[] = [];
    const input = {
      ...request,
      method: "POST" as const,
      body: new Uint8Array([65, 66]),
      idempotencyKey: "operation-1",
    };
    const h = await harness(
      mock((url, init) => {
        if (url.includes("auth.example"))
          return Response.json({ access_token: "new" });
        bodies.push(Buffer.from(init.body as Uint8Array).toString());
        keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
        input.body.fill(90);
        input.idempotencyKey = "changed";
        return new Response(null, { status: 401 });
      }),
    );
    assert.equal((await h.transport.request(h.binding, input)).status, 401);
    assert.deepEqual(bodies, ["AB", "AB"]);
    assert.deepEqual(keys, ["operation-1", "operation-1"]);
  });

  it("surfaces persistence failure without using issued tokens or replaying", async () => {
    const calls: string[] = [];
    const h = await harness(
      mock((url) => {
        calls.push(url);
        return url.includes("auth.example")
          ? Response.json({ access_token: "issued" })
          : new Response(null, { status: 401 });
      }),
    );
    h.binding.connection.update = async (change) => {
      if (typeof change === "function") await change({ grant: initial });
      throw new Error("private-vault-secret");
    };
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("credential_store_failed"),
    );
    assert.equal(calls.length, 2);
    assert.equal(
      (h.store.list()[0].config.grant as OAuthGrant).tokens.accessToken,
      "old",
    );
  });

  it("rejects identity changes and schema errors before injecting credentials", async () => {
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        return Response.json({});
      }),
    );
    h.binding.identity.name = "other";
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("binding_changed"),
    );
    h.binding.identity.name = "account";
    await h.binding.connection.update({ unexpected: "private" });
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("invalid_credentials"),
    );
    assert.equal(calls, 0);
  });

  it("redacts transport exceptions, rejects redirects and limits response size without retry", async () => {
    for (const reply of [
      () => {
        throw new Error("private-token");
      },
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/" },
        }),
      () => new Response("oversized"),
    ]) {
      let calls = 0;
      const fetch = mock(() => {
        calls++;
        return reply();
      });
      const h = await harness(fetch);
      const transport = new CredentialTransport(h.registry, {
        fetch,
        maxResponseBytes: 4,
      });
      await assert.rejects(
        transport.request(h.binding, request),
        (error: unknown) =>
          error instanceof AuthError && !String(error).includes("private"),
      );
      assert.equal(calls, 1);
    }
  });

  it("bounds even a stalled host fetch and rejects oversized requests before IO", async () => {
    let calls = 0;
    const fetch = mock(() => {
      calls++;
      return new Promise<Response>(() => {});
    });
    const h = await harness(fetch);
    const transport = new CredentialTransport(h.registry, {
      fetch,
      timeoutMs: 10,
      maxRequestBytes: 2,
    });
    await assert.rejects(
      transport.request(h.binding, { ...request, method: "POST", body: "abc" }),
      errorCode("request_not_allowed"),
    );
    assert.equal(calls, 0);
    await assert.rejects(
      transport.request(h.binding, request),
      errorCode("transport_failed"),
    );
    assert.equal(calls, 1);
  });

  it("honors explicit 403 renewal and surfaces revoked grants without a resource replay", async () => {
    const def = definition();
    const auth = def.methods.selected.authentication;
    if (auth.kind !== "oauth2") throw new Error();
    auth.rejectionStatus = 403;
    let calls = 0;
    const h = await harness(
      mock((url) => {
        calls++;
        return url.includes("auth.example")
          ? Response.json(
              { error: "invalid_grant", error_description: "private" },
              { status: 400 },
            )
          : new Response(null, { status: 403 });
      }),
      { grant: initial },
      def,
    );
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("reconnect_required"),
    );
    assert.equal(calls, 2);
    assert.deepEqual(await h.transport.probe(h.binding), {
      outcome: "rejected",
    });
  });

  it("pins host registration, handle and request inputs across asynchronous reads", async () => {
    const def = definition();
    const auth = def.methods.selected.authentication;
    if (auth.kind !== "oauth2") throw new Error();
    auth.renewal = "clientCredentials";
    const seen: string[] = [];
    const h = await harness(
      mock((url, init) => {
        seen.push(url);
        if (url.includes("auth.example")) {
          assert.equal(
            new URLSearchParams(String(init.body)).get("client_id"),
            "client",
          );
          return Response.json({ access_token: "app" });
        }
        return Response.json({});
      }),
      {},
      def,
    );
    const input = { ...request };
    const read = h.binding.connection.read;
    h.binding.connection.read = async () => {
      input.path = "https://evil.example/";
      if (h.binding.application)
        h.binding.application.clientId = "other-client";
      h.binding.identity.name = "other";
      h.binding.connection.update = async () => {
        throw new Error("replaced");
      };
      return read();
    };
    await h.transport.request(h.binding, input);
    assert.deepEqual(seen, [
      "https://auth.example/token",
      "https://api.example/v1/items",
    ]);
  });

  it("never renews or replays after the host fences a disconnected binding", async () => {
    let revoked = false;
    let calls = 0;
    const h = await harness(
      mock(() => {
        calls++;
        revoked = true;
        return new Response(null, { status: 401 });
      }),
    );
    const update = h.binding.connection.update;
    h.binding.connection.update = async (change) => {
      if (revoked) throw new Error("private-disconnected-account");
      return update(change);
    };
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("credential_store_failed"),
    );
    assert.equal(calls, 1);
    assert.equal((h.store.list()[0].config.grant as OAuthGrant).revision, "r1");
  });

  it("rejects a changed identity returned after issuance rather than replaying with it", async () => {
    let calls = 0;
    const h = await harness(
      mock((url) => {
        calls++;
        return url.includes("auth.example")
          ? Response.json({ access_token: "new" })
          : new Response(null, { status: 401 });
      }),
    );
    const update = h.binding.connection.update;
    h.binding.connection.update = async (change) => ({
      ...(await update(change)),
      name: "other",
    });
    await assert.rejects(
      h.transport.request(h.binding, request),
      errorCode("binding_changed"),
    );
    assert.equal(calls, 2);
  });

  it("keeps grants isolated across accounts sharing a registration and transport", async () => {
    const refreshes: string[] = [];
    const fetch = mock((url, init) => {
      if (url.includes("auth.example")) {
        const refresh = new URLSearchParams(String(init.body)).get(
          "refresh_token",
        );
        refreshes.push(String(refresh));
        return Response.json({ access_token: `access-${refresh}` });
      }
      return Response.json({
        token: new Headers(init.headers).get("authorization"),
      });
    });
    const a = await harness(fetch, {
      grant: {
        tokens: { accessToken: "expired", refreshToken: "alice", expiresAt: 1 },
        revision: "a",
      },
    });
    const b = await harness(fetch, {
      grant: {
        tokens: { accessToken: "expired", refreshToken: "bob", expiresAt: 1 },
        revision: "b",
      },
    });
    const results = await Promise.all(
      [a.binding, b.binding].map(async (binding) =>
        (await a.transport.request(binding, request)).json(),
      ),
    );
    assert.deepEqual(results, [
      { token: "Bearer access-alice" },
      { token: "Bearer access-bob" },
    ]);
    assert.deepEqual(refreshes.sort(), ["alice", "bob"]);
  });

  it("gives a target its declared deadline and response ceiling, capped by the host's", async () => {
    const def = definition("bearer");
    def.methods.selected.targets.slow = {
      baseUrl: "https://api.example/slow/",
      methods: ["GET"],
      timeoutMs: 60,
      maxResponseBytes: 16,
    };
    const stalled = mock(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response("0123456789")), 30),
        ),
    );
    const h = await harness(stalled, { key: { secret: "k" } }, def);
    const transport = new CredentialTransport(h.registry, {
      fetch: stalled,
      timeoutMs: 10,
      maxResponseBytes: 4,
    });
    // The default target keeps the host defaults; the slow one gets its own.
    await assert.rejects(
      transport.request(h.binding, request),
      errorCode("transport_failed"),
    );
    assert.equal(
      await (
        await transport.request(h.binding, { target: "slow", path: "x" })
      ).text(),
      "0123456789",
    );
    const capped = new CredentialTransport(h.registry, {
      fetch: stalled,
      maxTargetTimeoutMs: 20,
    });
    await assert.rejects(
      capped.request(h.binding, { target: "slow", path: "x" }),
      errorCode("transport_failed"),
    );
  });

  it("cancels a stalled response body on timeout", async () => {
    let cancelled = false;
    const fetch = mock(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    const h = await harness(fetch);
    const transport = new CredentialTransport(h.registry, {
      fetch,
      timeoutMs: 10,
    });
    await assert.rejects(
      transport.request(h.binding, request),
      errorCode("transport_failed"),
    );
    assert.equal(cancelled, true);
  });

  it("runs only declared probes and reports accepted/rejected/unverified without response text", async () => {
    for (const status of [200, 204, 401, 403, 404, 429, 500]) {
      const h = await harness(
        mock((url) => {
          assert.equal(url, "https://api.example/v1/me");
          return new Response(null, { status });
        }),
        { key: { secret: "secret" } },
        definition("apiKey"),
      );
      assert.deepEqual(await h.transport.probe(h.binding), {
        outcome:
          status === 200
            ? "accepted"
            : [401, 403].includes(status)
              ? "rejected"
              : "unverified",
        status,
      });
    }
    const def = definition();
    delete def.methods.selected.probe;
    const h = await harness(
      mock(() => {
        throw new Error("must not fetch");
      }),
      {},
      def,
    );
    assert.deepEqual(await h.transport.probe(h.binding), {
      outcome: "unverified",
    });
  });
});
