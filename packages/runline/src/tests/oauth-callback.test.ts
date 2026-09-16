import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  OAUTH_CALLBACK_URI,
  type RunOAuthOptions,
  runOAuth,
} from "../core/oauth.js";
import type { OAuthConfig } from "../plugin/types.js";

const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
const config = {
  authUrl: "https://auth.example/authorize",
  tokenUrl: "https://auth.example/token",
  scopes: [],
};
const credentials = {
  clientId: "client",
  clientSecret: "secret",
  onAuthUrl() {},
  callbackTimeoutMs: 2000,
};

function callback(state: string, values: Record<string, string>): string {
  const url = new URL(OAUTH_CALLBACK_URI);
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(values))
    url.searchParams.set(key, value);
  return url.toString();
}

describe("local OAuth callback lifecycle", () => {
  it("listens before opening the browser and ignores unbound errors before a valid callback", async () => {
    let requests = 0;
    globalThis.fetch = (async (_url, init) => {
      requests++;
      assert.equal(
        new URLSearchParams(String(init?.body)).get("code"),
        "accepted-code",
      );
      return Response.json({ access_token: "issued" });
    }) as typeof fetch;
    let visit: Promise<void> | undefined;
    const tokens = await runOAuth(config, {
      ...credentials,
      openBrowser(url) {
        visit = (async () => {
          const rejected = await nativeFetch(
            callback("wrong", { error: "private-provider-error" }),
          );
          assert.equal(rejected.status, 400);
          assert.ok(!(await rejected.text()).includes("private"));
          const state = new URL(url).searchParams.get("state");
          assert.ok(state);
          const accepted = await nativeFetch(
            callback(state, { code: "accepted-code" }),
          );
          assert.equal(accepted.status, 200);
          assert.match(await accepted.text(), /Authorization received/);
        })();
        return visit;
      },
    });
    await visit;
    assert.equal(tokens.accessToken, "issued");
    assert.equal(requests, 1);
  });

  it("pins endpoints, application credentials, scopes and launch hooks before awaiting consent", async () => {
    for (const explicit of [false, true]) {
      const flow: OAuthConfig = explicit
        ? {
            protocol: {
              id: "example",
              provider: "example",
              authorization: { url: config.authUrl },
              exchange: {
                url: config.tokenUrl,
                clientAuthentication: "client_secret_post",
              },
            },
            scopes: ["read"],
          }
        : { ...config, scopes: ["read"] };
      let calls = 0;
      globalThis.fetch = (async (url, init) => {
        calls++;
        assert.equal(String(url), config.tokenUrl);
        const fields = new URLSearchParams(String(init?.body));
        assert.equal(fields.get("client_id"), "client");
        assert.equal(fields.get("client_secret"), "secret");
        return Response.json({ access_token: "issued" });
      }) as typeof fetch;
      let visit: Promise<void> | undefined;
      const options: RunOAuthOptions = {
        ...credentials,
        onAuthUrl() {
          if (flow.protocol?.exchange)
            flow.protocol.exchange.url = "https://other.test/token";
          else if (!flow.protocol) flow.tokenUrl = "https://other.test/token";
          flow.scopes.push("write");
          options.clientId = "other-client";
          options.clientSecret = "other-secret";
          options.openBrowser = () => {
            throw new Error("must use pinned launcher");
          };
        },
        openBrowser(url) {
          visit = (async () => {
            const consent = new URL(url);
            assert.equal(consent.searchParams.get("scope"), "read");
            const state = consent.searchParams.get("state");
            assert.ok(state);
            const response = await nativeFetch(
              callback(state, { code: "accepted-code" }),
            );
            assert.equal(response.status, 200);
          })();
          return visit;
        },
      };
      assert.equal((await runOAuth(flow, options)).accessToken, "issued");
      await visit;
      assert.equal(calls, 1);
    }
  });

  it("redacts provider errors after state validation without exchanging a code", async () => {
    globalThis.fetch = (async (_url, _init): Promise<Response> => {
      throw new Error("must not exchange");
    }) as typeof fetch;
    let visit: Promise<void> | undefined;
    await assert.rejects(
      runOAuth(config, {
        ...credentials,
        openBrowser(url) {
          visit = (async () => {
            const state = new URL(url).searchParams.get("state");
            assert.ok(state);
            const result = await nativeFetch(
              callback(state, { error: "private-provider-error" }),
            );
            assert.equal(result.status, 400);
            assert.ok(!(await result.text()).includes("private"));
          })();
          return visit;
        },
      }),
      { message: "OAuth: authorization denied" },
    );
    await visit;
  });

  it("does not launch a browser after consent publication outlives the callback timeout", async () => {
    let release: (() => void) | undefined;
    let launches = 0;
    await assert.rejects(
      runOAuth(config, {
        ...credentials,
        callbackTimeoutMs: 20,
        onAuthUrl: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
        openBrowser() {
          launches++;
        },
      }),
      /timed out/,
    );
    assert.ok(release);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(launches, 0);
  });

  it("closes the listener after timeout and browser-launch failure", async () => {
    await assert.rejects(
      runOAuth(config, {
        ...credentials,
        callbackTimeoutMs: 20,
        openBrowser() {},
      }),
      /timed out/,
    );
    await assert.rejects(
      runOAuth(config, {
        ...credentials,
        openBrowser() {
          throw new Error("private-browser-error");
        },
      }),
      { message: "OAuth: browser launch failed" },
    );
    // Rebinding after each failure proves that the listener is released.
    await assert.rejects(
      runOAuth(config, {
        ...credentials,
        callbackTimeoutMs: 20,
        openBrowser() {},
      }),
      /timed out/,
    );
  });
});
