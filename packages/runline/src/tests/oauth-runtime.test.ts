import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AuthError } from "../auth/errors.js";
import {
  acquireOAuth2ClientToken,
  buildOAuth2AuthorizationUrl,
  exchangeOAuth2Code,
  refreshOAuth2Token,
} from "../auth/oauth2.js";
import { decodeOAuthTokens, requestOAuth2Token } from "../auth/token.js";
import type { OAuth2Definition, OAuthEvent } from "../auth/types.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { buildAuthUrl, exchangeAuthCode } from "../core/oauth.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const application = {
  clientId: "client:id with space",
  clientSecret: "secret:+",
};
const code = {
  application,
  code: "code-secret",
  redirectUri: "https://host.example/callback",
  codeVerifier: "verifier-secret",
};
const definition = (): OAuth2Definition => ({
  id: "example.oauth",
  provider: "example",
  authorization: {
    url: "https://auth.example/authorize",
    parameters: { access_type: "offline" },
  },
  exchange: {
    url: "https://auth.example/token",
    clientAuthentication: "client_secret_basic",
  },
  refresh: {
    url: "https://auth.example/refresh",
    clientAuthentication: "none",
    encoding: "json",
    grantType: null,
  },
  clientCredentials: {
    url: "https://auth.example/token",
    clientAuthentication: "client_secret_post",
  },
});

function mock(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (url, init) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof AuthError && error.code === code;
}

describe("OAuth2 definitions and protocol runtime", () => {
  it("builds consent with host-selected registration, state, PKCE and scopes", () => {
    const url = new URL(
      buildOAuth2AuthorizationUrl(definition(), {
        application,
        redirectUri: code.redirectUri,
        state: "state-secret",
        pkceChallenge: "challenge",
        scopes: ["read", "write"],
      }),
    );
    assert.equal(url.searchParams.get("client_id"), application.clientId);
    assert.equal(url.searchParams.get("state"), "state-secret");
    assert.equal(url.searchParams.get("scope"), "read write");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.has("client_secret"), false);
  });

  it("does not let provider extras or endpoint query fields replace protected protocol values", async () => {
    for (const key of [
      "state",
      "redirect_uri",
      "client_id",
      "scope",
      "code_challenge",
      "code_verifier",
      "grant_type",
    ]) {
      const def = definition();
      if (!def.authorization || !def.exchange) throw new Error("fixture");
      def.authorization.parameters = { [key]: "override" };
      assert.throws(
        () =>
          buildOAuth2AuthorizationUrl(def, {
            application,
            redirectUri: code.redirectUri,
            state: "state",
          }),
        errorCode("invalid_definition"),
      );
      def.exchange.parameters = { [key]: "override" };
      await assert.rejects(
        exchangeOAuth2Code(def, code),
        errorCode("invalid_definition"),
      );
      def.exchange.parameters = {};
      def.exchange.url += `?${key}=override`;
      await assert.rejects(
        exchangeOAuth2Code(def, code),
        errorCode("invalid_definition"),
      );
    }
  });

  it("uses RFC form-encoded Basic credentials for code exchange, not body credentials", async () => {
    const events: OAuthEvent[] = [];
    const tokens = await exchangeOAuth2Code(definition(), code, {
      now: () => 1000,
      onEvent: (event) => {
        events.push(event);
      },
      fetch: mock((url, init) => {
        assert.equal(url, "https://auth.example/token");
        const headers = new Headers(init.headers);
        assert.equal(
          Buffer.from(
            headers.get("authorization")?.slice(6) ?? "",
            "base64",
          ).toString(),
          "client%3Aid+with+space:secret%3A%2B",
        );
        const fields = new URLSearchParams(String(init.body));
        assert.equal(fields.has("client_secret"), false);
        assert.equal(fields.has("client_id"), false);
        assert.equal(fields.get("code_verifier"), code.codeVerifier);
        assert.equal(fields.get("grant_type"), "authorization_code");
        assert.equal(init.redirect, "error");
        assert.ok(init.signal);
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          unrelatedSecret: "discard",
        });
      }),
    });
    assert.deepEqual(tokens, {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 3601000,
    });
    assert.deepEqual(events, [
      {
        definition: "example.oauth",
        provider: "example",
        operation: "exchange",
        outcome: "issued",
      },
    ]);
  });

  it("supports public-client PKCE without requiring or sending a client secret", async () => {
    const def = definition();
    if (!def.exchange) throw new Error("fixture");
    def.exchange.clientAuthentication = "client_id";
    const tokens = await exchangeOAuth2Code(
      def,
      { ...code, application: { clientId: "public" } },
      {
        fetch: mock((_url, init) => {
          const fields = new URLSearchParams(String(init.body));
          assert.equal(fields.get("client_id"), "public");
          assert.equal(fields.has("client_secret"), false);
          assert.equal(new Headers(init.headers).has("authorization"), false);
          return Response.json({ access_token: "access" });
        }),
      },
    );
    assert.deepEqual(tokens, { accessToken: "access" });
  });

  it("supports separate refresh endpoints with only a JSON refresh token", async () => {
    const previous = {
      accessToken: "old",
      refreshToken: "r1",
      expiresAt: 1,
      scope: "read",
      tokenType: "Bearer",
    };
    const tokens = await refreshOAuth2Token(
      definition(),
      { application, tokens: previous },
      {
        fetch: mock((url, init) => {
          assert.equal(url, "https://auth.example/refresh");
          assert.equal(
            new Headers(init.headers).get("content-type"),
            "application/json",
          );
          assert.equal(new Headers(init.headers).has("authorization"), false);
          assert.deepEqual(JSON.parse(String(init.body)), {
            refresh_token: "r1",
          });
          return Response.json({ access_token: "new" });
        }),
      },
    );
    assert.deepEqual(tokens, {
      accessToken: "new",
      refreshToken: "r1",
      scope: "read",
      tokenType: "Bearer",
    });
    assert.equal(previous.expiresAt, 1);
  });

  it("maps provider envelopes and rotated refresh tokens without copying arbitrary fields", async () => {
    const def = definition();
    if (!def.refresh) throw new Error("fixture");
    def.refresh.response = {
      path: ["data", "tokens"],
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: "ttl",
    };
    const tokens = await refreshOAuth2Token(
      def,
      { tokens: { accessToken: "old", refreshToken: "r1" } },
      {
        now: () => 0,
        fetch: mock(() =>
          Response.json({
            data: {
              tokens: {
                access: "new",
                refresh: "r2",
                ttl: 60,
                private: "hidden",
              },
            },
          }),
        ),
      },
    );
    assert.deepEqual(tokens, {
      accessToken: "new",
      refreshToken: "r2",
      expiresAt: 60000,
    });
  });

  it("supports client credentials and explicit scopes", async () => {
    const tokens = await acquireOAuth2ClientToken(
      definition(),
      { application, scopes: ["resource/.default"] },
      {
        fetch: mock((_url, init) => {
          const fields = new URLSearchParams(String(init.body));
          assert.equal(fields.get("grant_type"), "client_credentials");
          assert.equal(fields.get("client_secret"), application.clientSecret);
          assert.equal(fields.get("scope"), "resource/.default");
          return Response.json({ access_token: "app" });
        }),
      },
    );
    assert.deepEqual(tokens, { accessToken: "app" });
  });

  it("fails unsupported operations without a network request", async () => {
    await assert.rejects(
      exchangeOAuth2Code({ id: "none", provider: "none" }, code),
      errorCode("unsupported_operation"),
    );
    await assert.rejects(
      requestOAuth2Token(
        {
          url: "https://auth.example/token",
          clientAuthentication: "client_secret_basic",
        },
        {},
        { clientId: "public" },
      ),
      errorCode("invalid_credentials"),
    );
  });

  it("rejects insecure endpoints and credentials embedded in URLs", async () => {
    for (const url of [
      "http://auth.example/token",
      "https://user:secret@auth.example/token",
      "https://auth.example/token#secret",
      "not-a-url",
    ]) {
      await assert.rejects(
        requestOAuth2Token({ url, clientAuthentication: "none" }, {}),
        errorCode("invalid_definition"),
      );
    }
  });

  it("validates optional token fields without coercing malformed values", () => {
    assert.deepEqual(decodeOAuthTokens({ access_token: "a" }), {
      accessToken: "a",
    });
    for (const value of [
      null,
      [],
      {},
      { access_token: "" },
      { access_token: "a", expires_in: "3600" },
      { access_token: "a", expires_in: Infinity },
      { access_token: "a", expires_in: 0 },
      { access_token: "a", refresh_token: null },
      { access_token: "a", scope: [] },
      { access_token: "a", error: "secret" },
    ]) {
      assert.throws(
        () => decodeOAuthTokens(value),
        errorCode("invalid_response"),
      );
    }
  });

  it("classifies invalid grants and emits redacted failures without raw causes", async () => {
    const events: OAuthEvent[] = [];
    await assert.rejects(
      refreshOAuth2Token(
        definition(),
        {
          tokens: {
            accessToken: "private-access",
            refreshToken: "private-refresh",
          },
        },
        {
          onEvent: (event) => {
            events.push(event);
          },
          fetch: mock(() =>
            Response.json(
              {
                error: "invalid_grant",
                error_description: "private-refresh was revoked",
              },
              { status: 400 },
            ),
          ),
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AuthError);
        assert.equal(error.code, "reconnect_required");
        assert.equal(error.status, 400);
        assert.equal(error.cause, undefined);
        assert.ok(!JSON.stringify(error).includes("private"));
        assert.ok(!String(error).includes("private"));
        return true;
      },
    );
    assert.deepEqual(events, [
      {
        definition: "example.oauth",
        provider: "example",
        operation: "refresh",
        outcome: "failed",
        code: "reconnect_required",
      },
    ]);
  });

  it("never retries network failures or exposes their exception text", async () => {
    let calls = 0;
    await assert.rejects(
      exchangeOAuth2Code(definition(), code, {
        fetch: mock(() => {
          calls++;
          throw new Error("private-client-secret in request");
        }),
      }),
      errorCode("request_failed"),
    );
    assert.equal(calls, 1);
  });

  it("rejects malformed, oversized, and HTTP-200 error responses safely", async () => {
    for (const response of [
      new Response("private-secret {"),
      new Response("x".repeat(1024 * 1024 + 1)),
      Response.json({ error: "unknown-private-error" }),
    ]) {
      await assert.rejects(
        exchangeOAuth2Code(definition(), code, { fetch: mock(() => response) }),
        (error: unknown) => {
          assert.ok(error instanceof AuthError);
          assert.ok(!String(error).includes("private"));
          return true;
        },
      );
    }
  });

  it("observer failures cannot lose successfully issued tokens", async () => {
    for (const onEvent of [
      () => {
        throw new Error("observer failed");
      },
      () => Promise.reject(new Error("async observer failed")),
    ]) {
      const tokens = await exchangeOAuth2Code(definition(), code, {
        fetch: mock(() => Response.json({ access_token: "issued" })),
        onEvent,
      });
      assert.equal(tokens.accessToken, "issued");
    }
  });

  it("runs refresh under the existing host-owned handle, once across concurrent callers", async () => {
    const store = new MemoryConnectionProvider([
      {
        name: "account",
        plugin: "probe",
        config: { tokens: { accessToken: "old", refreshToken: "r1" } },
      },
    ]);
    let calls = 0;
    const fetch = mock(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ access_token: "new", refresh_token: "r2" });
    });
    const handles = await Promise.all(
      [1, 2, 3].map(() => store.resolve({ plugin: "probe" })),
    );
    await Promise.all(
      handles.map((handle) =>
        handle.update(async (current) => {
          const tokens = current.tokens as {
            accessToken: string;
            refreshToken: string;
          };
          if (tokens.accessToken !== "old") return;
          return {
            tokens: await refreshOAuth2Token(
              definition(),
              { tokens },
              { fetch },
            ),
          };
        }),
      ),
    );
    assert.equal(calls, 1);
    assert.deepEqual(store.list()[0].config.tokens, {
      accessToken: "new",
      refreshToken: "r2",
    });
  });

  it("applies endpoint options identically through the low-level token API", async () => {
    const tokens = await requestOAuth2Token(
      {
        url: "https://auth.example/token",
        clientAuthentication: "none",
        grantType: null,
        parameters: { audience: "api" },
        response: { metadata: { instanceUrl: "instance_url" } },
      },
      { grant_type: "refresh_token", refresh_token: "r1" },
      undefined,
      {
        fetch: mock((_url, init) => {
          assert.deepEqual(
            Object.fromEntries(new URLSearchParams(String(init.body))),
            { audience: "api", refresh_token: "r1" },
          );
          return Response.json({
            access_token: "a",
            instance_url: "https://instance.example",
            unselected: "secret",
          });
        }),
      },
    );
    assert.deepEqual(tokens, {
      accessToken: "a",
      metadata: { instanceUrl: "https://instance.example" },
    });
    await assert.rejects(
      requestOAuth2Token(
        {
          url: "https://auth.example/token",
          clientAuthentication: "none",
          parameters: { client_secret: "override" },
        },
        {},
      ),
      errorCode("invalid_definition"),
    );
    await assert.rejects(
      requestOAuth2Token(
        {
          url: "https://auth.example/token?client_secret=secret",
          clientAuthentication: "none",
        },
        {},
      ),
      errorCode("invalid_definition"),
    );
  });

  it("pins response mapping and expiry origin before spending a token", async () => {
    const endpoint = {
      url: "https://auth.example/token",
      clientAuthentication: "none" as const,
      response: { accessToken: "access_token" },
    };
    let clock = 1000;
    let calls = 0;
    const tokens = await requestOAuth2Token(endpoint, {}, undefined, {
      now: () => {
        calls++;
        return clock;
      },
      fetch: mock(() => {
        clock = 9000;
        endpoint.response.accessToken = "private_field";
        return Response.json({
          access_token: "a",
          expires_in: 10,
          private_field: "must-not-be-a-token",
        });
      }),
    });
    assert.equal(tokens.expiresAt, 11000);
    assert.equal(tokens.accessToken, "a");
    assert.equal(calls, 1);
  });

  it("rejects outer error envelopes even when nested tokens look valid", () => {
    assert.throws(
      () =>
        decodeOAuthTokens(
          { error: "denied", data: { access_token: "a" } },
          { path: ["data"] },
        ),
      errorCode("invalid_response"),
    );
  });

  it("keeps the CLI compatibility API on the same decoder and protected URL builder", async () => {
    globalThis.fetch = mock(() =>
      Response.json({ access_token: "access-only" }),
    );
    const config = {
      authUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
      scopes: ["read"],
    };
    assert.deepEqual(
      await exchangeAuthCode(config, {
        clientId: "client",
        clientSecret: "secret",
        code: "code",
        redirectUri: code.redirectUri,
      }),
      { accessToken: "access-only" },
    );
    assert.throws(
      () =>
        buildAuthUrl(
          { ...config, authParams: { state: "override" } },
          { clientId: "client", redirectUri: code.redirectUri, state: "state" },
        ),
      errorCode("invalid_definition"),
    );
  });
});
