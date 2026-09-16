import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { googleAccessToken } from "../../../runline-plugins/_shared/googleAuth.js";
import { microsoftAccessToken } from "../../../runline-plugins/_shared/microsoftAuth.js";
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

const helpers = { google: googleAccessToken, microsoft: microsoftAccessToken };
for (const [name, accessToken] of Object.entries(helpers)) {
  describe(`${name} coordinated refresh`, () => {
    it("spends a rotating token once across stale contexts and persists the replacement", async () => {
      const store = provider();
      let requests = 0;
      globalThis.fetch = (async (_url, init) => {
        requests++;
        assert.equal(
          new URLSearchParams(String(init?.body)).get("refresh_token"),
          "r1",
        );
        assert.equal(init?.redirect, "error");
        await new Promise((r) => setTimeout(r, 10));
        return Response.json({
          access_token: "a1",
          refresh_token: "r2",
          expires_in: 3600,
        });
      }) as typeof fetch;
      const contexts = await Promise.all(
        [1, 2, 3].map(async () =>
          context(await store.resolve({ plugin: "probe" })),
        ),
      );
      assert.deepEqual(
        await Promise.all(
          contexts.map((ctx) => accessToken(ctx, name, ["scope"])),
        ),
        ["a1", "a1", "a1"],
      );
      assert.equal(requests, 1);
      assert.ok(
        contexts.every((ctx) => ctx.connection.config.refreshToken === "r2"),
      );
      assert.equal(store.list()[0].config.refreshToken, "r2");
    });

    it("preserves an existing refresh token when the provider omits a replacement", async () => {
      const store = provider();
      globalThis.fetch = (async () =>
        Response.json({
          access_token: "a1",
          expires_in: 3600,
        })) as typeof fetch;
      const ctx = await context(await store.resolve({ plugin: "probe" }));
      assert.equal(await accessToken(ctx, name, []), "a1");
      assert.equal(store.list()[0].config.refreshToken, "r1");
    });

    it("clears an old expiry when renewal omits it, then reuses the unknown-expiry token", async () => {
      const store = provider({
        accessToken: "expired",
        accessTokenExpiresAt: 1,
      });
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return Response.json({ access_token: "no-expiry" });
      }) as typeof fetch;
      const ctx = await context(await store.resolve({ plugin: "probe" }));
      assert.equal(await accessToken(ctx, name, []), "no-expiry");
      assert.equal(store.list()[0].config.accessTokenExpiresAt, undefined);
      assert.equal(
        await accessToken(
          await context(await store.resolve({ plugin: "probe" })),
          name,
          [],
        ),
        "no-expiry",
      );
      assert.equal(calls, 1);
    });

    it("rejects malformed responses without committing tokens or leaking response text", async () => {
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
        globalThis.fetch = (async () => response) as typeof fetch;
        await assert.rejects(accessToken(ctx, name, []), (err: Error) => {
          assert.ok(!err.message.includes("private-token"));
          return true;
        });
        assert.equal(store.list()[0].config.accessToken, undefined);
      }
    });

    it("surfaces persistence failure without returning or installing the issued token", async () => {
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
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return Response.json({
          access_token: "issued",
          refresh_token: "rotated",
          expires_in: 3600,
        });
      }) as typeof fetch;
      await assert.rejects(accessToken(ctx, name, []), /Persistence failed/);
      assert.equal(calls, 1);
      assert.equal(ctx.connection.config.accessToken, undefined);
      assert.equal(ctx.connection.config.refreshToken, "r1");
    });
  });
}

it("Google service-account refresh shares the same coordination", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const store = provider({
    serviceAccountEmail: "service@example.com",
    serviceAccountPrivateKey: privateKey,
  });
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    assert.equal(
      new URLSearchParams(String(init?.body)).get("grant_type"),
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    return Response.json({ access_token: "service-token", expires_in: 3600 });
  }) as typeof fetch;
  const contexts = await Promise.all(
    [1, 2].map(async () => context(await store.resolve({ plugin: "probe" }))),
  );
  assert.deepEqual(
    await Promise.all(
      contexts.map((ctx) => googleAccessToken(ctx, "google", ["scope"])),
    ),
    ["service-token", "service-token"],
  );
  assert.equal(calls, 1);
});

it("Microsoft app-only acquisition uses the same coordinated runtime", async () => {
  const store = provider({ refreshToken: undefined, tenantId: "tenant" });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    );
    assert.equal(
      new URLSearchParams(String(init?.body)).get("grant_type"),
      "client_credentials",
    );
    return Response.json({ access_token: "app-token", expires_in: 3600 });
  }) as typeof fetch;
  const contexts = await Promise.all(
    [1, 2].map(async () => context(await store.resolve({ plugin: "probe" }))),
  );
  assert.deepEqual(
    await Promise.all(
      contexts.map((ctx) => microsoftAccessToken(ctx, "microsoft", [])),
    ),
    ["app-token", "app-token"],
  );
  assert.equal(calls, 1);
});
