import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as t from "typebox";
import { AuthError } from "../auth/errors.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import {
  CredentialRegistry,
  OAuthGrantSchema,
} from "../credentials/registry.js";
import {
  type AuthenticatedRequest,
  CredentialTransport,
} from "../credentials/transport.js";
import type {
  CredentialBinding,
  CredentialMethod,
  CredentialType,
  OAuthGrant,
} from "../credentials/types.js";

const initial: OAuthGrant = {
  tokens: { accessToken: "old", refreshToken: "r1" },
  revision: "r1",
};
function definition(
  kind: "oauth2" | "bearer" | "apiKey" = "oauth2",
): CredentialType {
  const method: CredentialMethod = {
    schema:
      kind === "oauth2"
        ? t.Object(
            { grant: t.Optional(OAuthGrantSchema) },
            { additionalProperties: false },
          )
        : t.Object(
            { key: t.String({ minLength: 1 }) },
            { additionalProperties: false },
          ),
    authentication:
      kind === "oauth2"
        ? {
            kind,
            grantField: "grant",
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
          }
        : kind === "bearer"
          ? { kind, field: "key" }
          : { kind, field: "key", header: "X-Api-Key" },
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
  return { id: "example", methods: { selected: method } };
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
  it("injects API keys and bearer tokens without query credentials or ambient cookies", async () => {
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
        { key: "private" },
        definition(kind),
      );
      assert.deepEqual(
        await (await h.transport.request(h.binding, request)).json(),
        { ok: true },
      );
    }
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
        { key: "secret" },
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
