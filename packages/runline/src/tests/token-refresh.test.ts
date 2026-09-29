/**
 * The local signer's token lifecycle, observed where it matters: the
 * bearer a resource request is signed with. Renewal is coordinated
 * through the connection handle, persisted before use, and never
 * surfaces provider text.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { googleResponse } from "../../../runline-plugins/_shared/googleAuth.js";
import { graphResponse } from "../../../runline-plugins/_shared/microsoftAuth.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import type { ConnectionHandle } from "../connections/types.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function context(handle: ConnectionHandle): Promise<ActionContext> {
  const connection = await handle.read();
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
}

function provider(config: Record<string, unknown> = {}) {
  return new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "probe",
      config: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "r1",
        ...config,
      },
    },
  ]);
}

/**
 * Serve token issuance through `issue`, and answer every resource request
 * with 200, recording the bearer it carried. Returns those bearers.
 */
function serve(
  issue: (url: string, init: RequestInit) => Response | Promise<Response>,
): string[] {
  const bearers: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/token")) return issue(String(url), init ?? {});
    bearers.push(new Headers(init?.headers).get("authorization") ?? "");
    return Response.json({});
  }) as typeof fetch;
  return bearers;
}

/** One resource read through each family's local signer. */
const reads = {
  google: (ctx: ActionContext, scopes: string[]) =>
    googleResponse(
      ctx,
      "googleDrive",
      scopes,
      "https://www.googleapis.com/drive/v3/files",
    ),
  microsoft: (ctx: ActionContext, scopes: string[]) =>
    graphResponse(ctx, "microsoftFiles", scopes, "GET", "/me/drive/root"),
};

for (const [name, read] of Object.entries(reads)) {
  describe(`${name} coordinated refresh`, () => {
    it("spends a rotating token once across stale contexts and persists the replacement", async () => {
      const store = provider();
      let issued = 0;
      const bearers = serve(async (_url, init) => {
        issued++;
        assert.equal(
          new URLSearchParams(String(init.body)).get("refresh_token"),
          "r1",
        );
        assert.equal(init.redirect, "error");
        await new Promise((r) => setTimeout(r, 10));
        return Response.json({
          access_token: "a1",
          refresh_token: "r2",
          expires_in: 3600,
        });
      });
      const contexts = await Promise.all(
        [1, 2, 3].map(async () =>
          context(await store.resolve({ plugin: "probe" })),
        ),
      );
      await Promise.all(contexts.map((ctx) => read(ctx, ["scope"])));
      assert.deepEqual(bearers, ["Bearer a1", "Bearer a1", "Bearer a1"]);
      assert.equal(issued, 1);
      assert.ok(
        contexts.every((ctx) => ctx.connection.config.refreshToken === "r2"),
      );
      assert.equal(store.list()[0].config.refreshToken, "r2");
    });

    it("preserves an existing refresh token when the provider omits a replacement", async () => {
      const store = provider();
      const bearers = serve(() =>
        Response.json({ access_token: "a1", expires_in: 3600 }),
      );
      await read(await context(await store.resolve({ plugin: "probe" })), []);
      assert.deepEqual(bearers, ["Bearer a1"]);
      assert.equal(store.list()[0].config.refreshToken, "r1");
    });

    it("clears an old expiry when renewal omits it, then reuses the unknown-expiry token", async () => {
      const store = provider({
        accessToken: "expired",
        accessTokenExpiresAt: 1,
      });
      let issued = 0;
      const bearers = serve(() => {
        issued++;
        return Response.json({ access_token: "no-expiry" });
      });
      await read(await context(await store.resolve({ plugin: "probe" })), []);
      assert.equal(store.list()[0].config.accessTokenExpiresAt, undefined);
      await read(await context(await store.resolve({ plugin: "probe" })), []);
      assert.deepEqual(bearers, ["Bearer no-expiry", "Bearer no-expiry"]);
      assert.equal(issued, 1);
    });

    it("rejects malformed responses without committing tokens, reaching the resource, or leaking response text", async () => {
      const store = provider();
      const ctx = await context(await store.resolve({ plugin: "probe" }));
      for (const response of [
        Response.json({ error: "private-token" }, { status: 400 }),
        new Response('{"private-token":broken'),
        Response.json({ access_token: "private-token", expires_in: "3600" }),
        Response.json({
          access_token: "private-token",
          expires_in: 3600,
          refresh_token: {},
        }),
        Response.json(null),
      ]) {
        const bearers = serve(() => response);
        await assert.rejects(read(ctx, []), (err: Error) => {
          assert.ok(!err.message.includes("private-token"));
          return true;
        });
        assert.deepEqual(bearers, []);
        assert.equal(store.list()[0].config.accessToken, undefined);
      }
    });

    it("surfaces persistence failure without signing with or installing the issued token", async () => {
      const store = provider();
      const handle = await store.resolve({ plugin: "probe" });
      const ctx = await context({
        read: handle.read,
        async update(change) {
          assert.equal(typeof change, "function");
          if (typeof change === "function")
            await change((await handle.read()).config);
          throw new Error("Persistence failed");
        },
      });
      let issued = 0;
      const bearers = serve(() => {
        issued++;
        return Response.json({
          access_token: "issued",
          refresh_token: "rotated",
          expires_in: 3600,
        });
      });
      await assert.rejects(read(ctx, []), {
        name: "AuthError",
        code: "credential_store_failed",
        message: "Credential storage failed; provider outcome may be unknown",
      });
      assert.equal(issued, 1);
      assert.deepEqual(bearers, []);
      assert.equal(ctx.connection.config.accessToken, undefined);
      assert.equal(ctx.connection.config.refreshToken, "r1");
    });
  });
}

it("Google service-account issuance shares the same coordination", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const store = provider({
    serviceAccountEmail: "service@example.com",
    serviceAccountPrivateKey: privateKey,
  });
  let issued = 0;
  const bearers = serve((_url, init) => {
    issued++;
    assert.equal(
      new URLSearchParams(String(init.body)).get("grant_type"),
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    return Response.json({ access_token: "service-token", expires_in: 3600 });
  });
  const contexts = await Promise.all(
    [1, 2].map(async () => context(await store.resolve({ plugin: "probe" }))),
  );
  await Promise.all(contexts.map((ctx) => reads.google(ctx, ["scope"])));
  assert.deepEqual(bearers, ["Bearer service-token", "Bearer service-token"]);
  assert.equal(issued, 1);
});

it("Microsoft app-only acquisition uses the same coordinated signer", async () => {
  const store = provider({ refreshToken: undefined, tenantId: "tenant" });
  let issued = 0;
  const bearers = serve((url, init) => {
    issued++;
    assert.equal(
      url,
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    );
    assert.equal(
      new URLSearchParams(String(init.body)).get("grant_type"),
      "client_credentials",
    );
    return Response.json({ access_token: "app-token", expires_in: 3600 });
  });
  const contexts = await Promise.all(
    [1, 2].map(async () => context(await store.resolve({ plugin: "probe" }))),
  );
  await Promise.all(
    contexts.map((ctx) =>
      graphResponse(
        ctx,
        "microsoftFiles",
        [],
        "GET",
        "/users/agent/drive/root",
      ),
    ),
  );
  assert.deepEqual(bearers, ["Bearer app-token", "Bearer app-token"]);
  assert.equal(issued, 1);
});
