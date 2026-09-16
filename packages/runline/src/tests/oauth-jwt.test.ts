import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, it } from "node:test";
import { googleAccessToken } from "../../../runline-plugins/_shared/googleAuth.js";
import { acquireOAuth2JwtToken } from "../auth/oauth2.js";
import type { OAuth2Definition } from "../auth/types.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import type { ActionContext } from "../plugin/types.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const definition: OAuth2Definition = {
  id: "google.serviceAccount",
  provider: "google",
  jwtBearer: {
    url: "https://oauth2.googleapis.com/token",
    clientAuthentication: "none",
  },
};
const identity = {
  issuer: "service@example.com",
  privateKey,
  subject: "user@example.com",
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("signs an RS256 assertion with pinned audience, scopes, subject, and bounded lifetime", async () => {
  const events: unknown[] = [];
  const tokens = await acquireOAuth2JwtToken(
    definition,
    { identity, scopes: ["scope.one", "scope.two"] },
    {
      now: () => 1_700_000_000_000,
      onEvent: (event) => {
        events.push(event);
      },
      fetch: (async (url, init) => {
        assert.equal(String(url), definition.jwtBearer?.url);
        assert.equal(init?.redirect, "error");
        const fields = new URLSearchParams(String(init?.body));
        assert.equal(
          fields.get("grant_type"),
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        assert.equal(fields.get("client_secret"), null);
        const assertion = fields.get("assertion");
        assert.ok(assertion);
        const [header, payload, signature] = assertion.split(".");
        assert.deepEqual(
          JSON.parse(Buffer.from(header, "base64url").toString()),
          { alg: "RS256", typ: "JWT" },
        );
        assert.deepEqual(
          JSON.parse(Buffer.from(payload, "base64url").toString()),
          {
            iss: identity.issuer,
            sub: identity.subject,
            aud: definition.jwtBearer?.url,
            scope: "scope.one scope.two",
            iat: 1_700_000_000,
            exp: 1_700_003_600,
          },
        );
        assert.ok(
          verify(
            "RSA-SHA256",
            Buffer.from(`${header}.${payload}`),
            publicKey,
            Buffer.from(signature, "base64url"),
          ),
        );
        return Response.json({ access_token: "issued", expires_in: 3600 });
      }) as typeof fetch,
    },
  );
  assert.equal(tokens.expiresAt, 1_700_003_600_000);
  assert.deepEqual(events, [
    {
      definition: definition.id,
      provider: "google",
      operation: "jwtBearer",
      outcome: "issued",
    },
  ]);
});

it("rejects invalid signing material and scope injection without IO or private errors", async () => {
  let calls = 0;
  const fetch = (async (
    _url: Parameters<typeof globalThis.fetch>[0],
  ): Promise<Response> => {
    calls++;
    throw new Error("unexpected");
  }) as typeof globalThis.fetch;
  for (const input of [
    {
      identity: { ...identity, privateKey: "PRIVATE-KEY-SECRET" },
      scopes: ["scope"],
    },
    { identity, scopes: ["scope another"] },
    { identity, scopes: [] },
    { identity: { ...identity, subject: "" }, scopes: ["scope"] },
  ]) {
    await assert.rejects(acquireOAuth2JwtToken(definition, input, { fetch }), {
      name: "AuthError",
      code: "invalid_credentials",
    });
  }
  assert.equal(calls, 0);
});

async function context(
  store: MemoryConnectionProvider,
): Promise<ActionContext> {
  const handle = await store.resolve({ plugin: "googleDrive" });
  const connection = await handle.read();
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
}

it("Google compatibility selection respects explicit delegated mode and invalidates scope/subject changes", async () => {
  const store = new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "googleDrive",
      config: {
        authMethod: "delegated",
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
        serviceAccountEmail: identity.issuer,
        serviceAccountPrivateKey: privateKey,
      },
    },
  ]);
  const grants: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const grant = new URLSearchParams(String(init?.body)).get("grant_type");
    assert.ok(grant);
    grants.push(grant);
    return Response.json({
      access_token: `token-${grants.length}`,
      expires_in: 3600,
    });
  }) as typeof fetch;
  assert.equal(
    await googleAccessToken(await context(store), "googleDrive", ["scope"]),
    "token-1",
  );
  assert.equal(grants[0], "refresh_token");
  const handle = await store.resolve({ plugin: "googleDrive" });
  await handle.update({ authMethod: "serviceAccount" });
  assert.equal(
    await googleAccessToken(await context(store), "googleDrive", ["scope"]),
    "token-2",
  );
  assert.equal(
    await googleAccessToken(await context(store), "googleDrive", ["scope"]),
    "token-2",
  );
  assert.equal(
    await googleAccessToken(await context(store), "googleDrive", [
      "other.scope",
    ]),
    "token-3",
  );
  await handle.update({ serviceAccountSubject: "new-user@example.com" });
  assert.equal(
    await googleAccessToken(await context(store), "googleDrive", [
      "other.scope",
    ]),
    "token-4",
  );
  assert.deepEqual(
    grants.slice(1),
    Array(3).fill("urn:ietf:params:oauth:grant-type:jwt-bearer"),
  );
});

it("Google JSON credentials cannot override the token endpoint or silently fall back when malformed", async () => {
  const store = new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "googleDrive",
      config: {
        serviceAccountJson: JSON.stringify({
          client_email: identity.issuer,
          private_key: privateKey,
          token_uri: "https://attacker.example/token",
        }),
      },
    },
  ]);
  let calls = 0;
  globalThis.fetch = (async (url) => {
    calls++;
    assert.equal(String(url), "https://oauth2.googleapis.com/token");
    return Response.json({ access_token: "issued" });
  }) as typeof fetch;
  await googleAccessToken(await context(store), "googleDrive", ["scope"]);
  const handle = await store.resolve({ plugin: "googleDrive" });
  await handle.update({
    serviceAccountJson: "malformed-secret",
    serviceAccountEmail: identity.issuer,
    serviceAccountPrivateKey: privateKey,
  });
  await assert.rejects(
    googleAccessToken(await context(store), "googleDrive", ["scope"]),
    { code: "invalid_credentials" },
  );
  assert.equal(calls, 1);
});
