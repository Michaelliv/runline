import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import plaud from "../../../runline-plugins/plaud/src/index.js";
import {
  PLAUD_CREDENTIAL,
  PLAUD_OAUTH,
  plaudRuntime,
} from "../../../runline-plugins/plaud/src/shared.js";
import {
  buildOAuth2AuthorizationUrl,
  exchangeOAuth2Code,
} from "../auth/oauth2.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import {
  buildAuthUrl,
  exchangeAuthCode,
  OAUTH_CALLBACK_URI,
  runOAuth,
} from "../core/oauth.js";
import { CredentialRegistry } from "../credentials/registry.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, OAuthConfig } from "../plugin/types.js";

const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
function mock(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (url, init) =>
    handler(String(url), init ?? {})) as typeof fetch;
}
const { api, resolve } = createPluginAPI("test");
plaud(api);
const plugin = resolve();
function action(name: string) {
  const result = plugin.actions.find((a) => a.name === name);
  assert.ok(result);
  return result;
}
async function context(config: Record<string, unknown> = {}) {
  const store = new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "plaud",
      config: { accessToken: "old", refreshToken: "r1", ...config },
    },
  ]);
  const handle = await store.resolve({ plugin: "plaud" });
  const connection = await handle.read();
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
  return { ctx, handle };
}
async function execute(
  name: string,
  input: unknown = {},
  config: Record<string, unknown> = {},
) {
  return action(name).execute(input, (await context(config)).ctx);
}
const tokenUrl =
  "https://platform.plaud.ai/developer/api/oauth/third-party/access-token";
const apiBase = "https://platform.plaud.ai/developer/api/open/third-party/";

describe("native Plaud plugin", () => {
  it("declares only nine read actions, strict input schemas and a fixed current-user probe", () => {
    assert.equal(plugin.name, "plaud");
    assert.equal(plugin.actions.length, 9);
    assert.ok(plugin.actions.every((a) => a.access === "read"));
    for (const [name, input] of [
      ["recording.list", { page: 0 }],
      ["recording.list", { pageSize: 9 }],
      ["recording.list", { pageSize: 101 }],
      ["recording.search", { query: " " }],
      ["recording.search", { query: "a", maxPages: 11 }],
      ["recording.get", { id: "" }],
      ["recording.get", { id: "a", baseUrl: "https://evil.test" }],
      ["transcript.get", { id: "a", block: "arbitrary" }],
      ["transcript.get", { id: "a", contentOrigins: ["https://evil.test"] }],
      ["recording.recent", { days: 0 }],
      ["summary.get", { id: "a", index: -1 }],
    ] as const)
      assert.equal(Check(action(name).inputSchema as TSchema, input), false);
    assert.deepEqual(PLAUD_CREDENTIAL.methods.oauth2.probe, {
      target: "api",
      path: "users/current",
      method: "GET",
      acceptedStatuses: [200],
    });
  });

  it("uses PKCE, validated state, Basic code exchange and no grant_type through the generic CLI adapter", async () => {
    assert.ok(plugin.oauth);
    const options = {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://host.test/callback",
      code: "code",
      state: "bound-state",
      codeVerifier: "verifier",
    };
    const auth = new URL(
      buildAuthUrl(plugin.oauth, { ...options, pkceChallenge: "challenge" }),
    );
    assert.equal(
      auth.origin + auth.pathname,
      "https://web.plaud.ai/platform/oauth",
    );
    assert.equal(auth.searchParams.get("state"), options.state);
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.searchParams.has("scope"), false);
    let requests = 0;
    mock((url, init) => {
      requests++;
      assert.equal(url, tokenUrl);
      assert.equal(init.redirect, "error");
      assert.equal(
        new Headers(init.headers).get("authorization"),
        `Basic ${Buffer.from("client:secret").toString("base64")}`,
      );
      assert.deepEqual(
        Object.fromEntries(new URLSearchParams(String(init.body))),
        {
          code: "code",
          redirect_uri: options.redirectUri,
          code_verifier: "verifier",
          state: "bound-state",
        },
      );
      return Response.json({
        access_token: "issued",
        refresh_token: "rotated",
        expires_in: 3600,
      });
    });
    const tokens = await exchangeAuthCode(plugin.oauth, options);
    assert.equal(tokens.accessToken, "issued");
    assert.equal(tokens.refreshToken, "rotated");
    await assert.rejects(
      exchangeAuthCode(plugin.oauth, { ...options, state: undefined }),
      { code: "invalid_credentials" },
    );
    await assert.rejects(
      exchangeAuthCode(plugin.oauth, { ...options, codeVerifier: undefined }),
      { code: "invalid_credentials" },
    );
    const oauth = plugin.oauth;
    assert.throws(() => buildAuthUrl(oauth, { ...options }), {
      code: "invalid_credentials",
    });
    assert.equal(requests, 1);
  });

  it("rejects conflicting endpoint declarations and malformed exchange policies before IO", async () => {
    assert.ok(plugin.oauth);
    let calls = 0;
    mock(() => {
      calls++;
      return Response.json({ access_token: "unexpected" });
    });
    const input = {
      clientId: "client",
      clientSecret: "secret",
      state: "state",
      redirectUri: "https://host.test/cb",
      code: "code",
      codeVerifier: "verifier",
      pkceChallenge: "challenge",
    };
    for (const override of [
      { authUrl: "https://other.test/auth" },
      { tokenUrl: "https://other.test/token" },
      { authParams: {} },
    ]) {
      const invalid = {
        ...plugin.oauth,
        ...override,
      } as unknown as OAuthConfig;
      assert.throws(() => buildAuthUrl(invalid, input), {
        code: "invalid_definition",
      });
      await assert.rejects(exchangeAuthCode(invalid, input), {
        code: "invalid_definition",
      });
    }
    for (const key of ["sendState", "requirePkce"]) {
      for (const value of [null, 0, "false", {}]) {
        const definition = structuredClone(PLAUD_OAUTH);
        assert.ok(definition.exchange);
        Object.assign(definition.exchange, { [key]: value });
        const oauth: OAuthConfig = { protocol: definition, scopes: [] };
        assert.throws(() => buildAuthUrl(oauth, input), {
          code: "invalid_definition",
        });
        await assert.rejects(exchangeAuthCode(oauth, input), {
          code: "invalid_definition",
        });
        const credential = structuredClone(PLAUD_CREDENTIAL);
        const auth = credential.methods.oauth2.authentication;
        assert.equal(auth.kind, "oauth2");
        if (auth.kind === "oauth2") auth.definition = definition;
        assert.throws(() => new CredentialRegistry().register(credential), {
          code: "invalid_definition",
        });
      }
    }
    assert.equal(calls, 0);
  });

  it("carries callback-validated state into end-to-end CLI code exchange", async () => {
    assert.ok(plugin.oauth);
    let state: string | null = null;
    mock((_url, init) => {
      const body = new URLSearchParams(String(init.body));
      assert.ok(state);
      assert.equal(body.get("state"), state);
      assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "issued" });
    });
    let visit: Promise<void> | undefined;
    const result = await runOAuth(plugin.oauth, {
      clientId: "client",
      clientSecret: "secret",
      onAuthUrl() {},
      callbackTimeoutMs: 2000,
      openBrowser(url) {
        state = new URL(url).searchParams.get("state");
        visit = (async () => {
          const callback = new URL(OAUTH_CALLBACK_URI);
          assert.ok(state);
          callback.searchParams.set("state", state);
          callback.searchParams.set("code", "accepted");
          const response = await nativeFetch(callback);
          assert.equal(response.status, 200);
        })();
        return visit;
      },
    });
    await visit;
    assert.equal(result.accessToken, "issued");
  });

  it("does not let declarations replace protocol-owned state or transmit state for ordinary providers", async () => {
    assert.throws(
      () =>
        buildOAuth2AuthorizationUrl(
          {
            ...PLAUD_OAUTH,
            authorization: {
              url: "https://host.test/auth",
              parameters: { state: "injected" },
            },
          },
          {
            application: { clientId: "client" },
            redirectUri: "https://host.test/cb",
            state: "safe",
            pkceChallenge: "challenge",
          },
        ),
      { code: "invalid_definition" },
    );
    mock((_url, init) => {
      assert.equal(new URLSearchParams(String(init.body)).has("state"), false);
      return Response.json({ access_token: "issued" });
    });
    await exchangeOAuth2Code(
      {
        id: "ordinary",
        provider: "ordinary",
        exchange: {
          url: "https://host.test/token",
          clientAuthentication: "none",
        },
      },
      {
        application: { clientId: "client" },
        code: "code",
        redirectUri: "https://host.test/cb",
        state: "not-needed",
      },
    );
  });

  it("renews refresh-token-only connections without an application, durably before reading resources", async () => {
    const { ctx, handle } = await context({ accessToken: undefined });
    const seen: string[] = [];
    mock(async (url, init) => {
      seen.push(url);
      if (url === `${tokenUrl}/refresh`) {
        assert.equal(new Headers(init.headers).has("authorization"), false);
        assert.deepEqual(
          Object.fromEntries(new URLSearchParams(String(init.body))),
          { refresh_token: "r1" },
        );
        return Response.json({ access_token: "issued", refresh_token: "r2" });
      }
      assert.equal(url, `${apiBase}users/current`);
      assert.equal(
        new Headers(init.headers).get("authorization"),
        "Bearer issued",
      );
      assert.equal((await handle.read()).config.refreshToken, "r2");
      return Response.json({ id: "user" });
    });
    assert.deepEqual(await action("user.get").execute({}, ctx), { id: "user" });
    assert.equal(seen.length, 2);
    assert.equal(typeof ctx.connection.config.authTokenRevision, "string");
  });

  it("replays a rejected GET once, preserves an omitted refresh token and clears stale expiry", async () => {
    const { ctx } = await context();
    let calls = 0;
    mock((url, init) => {
      calls++;
      if (url === `${tokenUrl}/refresh`)
        return Response.json({ access_token: "new" });
      return new Headers(init.headers).get("authorization") === "Bearer old"
        ? new Response(null, { status: 401 })
        : Response.json({ id: "ok" });
    });
    await action("recording.get").execute({ id: "file" }, ctx);
    assert.equal(calls, 3);
    assert.equal(ctx.connection.config.refreshToken, "r1");
    assert.equal(ctx.connection.config.accessTokenExpiresAt, undefined);
    const stale = await context({ accessTokenExpiresAt: 1 });
    await action("user.get").execute({}, stale.ctx);
    assert.equal(stale.ctx.connection.config.accessTokenExpiresAt, undefined);
    assert.equal(calls, 5);
  });

  it("coalesces concurrent renewal and aborts use of replacement tokens on persistence failure", async () => {
    const { ctx, handle } = await context({ accessTokenExpiresAt: 1 });
    let renewals = 0;
    mock(async (url) => {
      if (url === `${tokenUrl}/refresh`) {
        renewals++;
        await new Promise((r) => setTimeout(r, 5));
        return Response.json({ access_token: "same", refresh_token: "r2" });
      }
      return Response.json({});
    });
    const other: ActionContext = {
      ...ctx,
      connection: await handle.read(),
      async updateConnection(change) {
        this.connection.config = (await handle.update(change)).config;
      },
    };
    await Promise.all([
      action("user.get").execute({}, ctx),
      action("user.get").execute({}, other),
    ]);
    assert.equal(renewals, 1);
    const failed = await context({ accessTokenExpiresAt: 1 });
    failed.ctx.updateConnection = async (change) => {
      assert.equal(typeof change, "function");
      if (typeof change === "function")
        await change(failed.ctx.connection.config);
      throw new Error("secret-storage-error");
    };
    let resources = 0;
    mock((url) => {
      if (url === `${tokenUrl}/refresh`)
        return Response.json({ access_token: "uncommitted" });
      resources++;
      return Response.json({});
    });
    await assert.rejects(
      action("user.get").execute({}, failed.ctx) as Promise<unknown>,
      { code: "credential_store_failed" },
    );
    assert.equal(resources, 0);
    assert.equal(failed.ctx.connection.config.accessToken, "old");
  });

  it("does not retry 403/429/5xx/network failures or leak provider errors", async () => {
    for (const status of [403, 429, 500]) {
      let calls = 0;
      mock(() => {
        calls++;
        return new Response("private-provider-detail", { status });
      });
      await assert.rejects(execute("user.get"), {
        message: `plaud: request failed (HTTP ${status})`,
      });
      assert.equal(calls, 1);
    }
    mock(() => {
      throw new Error("secret-url-and-token");
    });
    await assert.rejects(execute("user.get"), {
      code: "transport_failed",
      message: "Authenticated request failed; remote outcome may be unknown",
    });
    mock(() => new Response("secret malformed JSON"));
    await assert.rejects(execute("user.get"), { code: "invalid_response" });
  });

  it("stops after repeated rejection and preserves the stored grant on failed renewal", async () => {
    let calls = 0;
    mock((url) => {
      calls++;
      return url === `${tokenUrl}/refresh`
        ? Response.json({ access_token: "old", refresh_token: "r2" })
        : new Response("private", { status: 401 });
    });
    const h = await context();
    await assert.rejects(
      action("user.get").execute({}, h.ctx) as Promise<unknown>,
      { message: "plaud: request failed (HTTP 401)" },
    );
    assert.equal(calls, 3);
    assert.equal((await h.handle.read()).config.refreshToken, "r2");
    for (const [response, code] of [
      [
        Response.json(
          { error: "invalid_grant", error_description: "private" },
          { status: 400 },
        ),
        "reconnect_required",
      ],
      [
        Response.json({ access_token: "", refresh_token: "must-not-save" }),
        "invalid_response",
      ],
    ] as const) {
      const failed = await context({ accessTokenExpiresAt: 1 });
      const before = await failed.handle.read();
      calls = 0;
      mock((url) => {
        calls++;
        assert.equal(url, `${tokenUrl}/refresh`);
        return response;
      });
      await assert.rejects(
        action("user.get").execute({}, failed.ctx) as Promise<unknown>,
        { code },
      );
      assert.equal(calls, 1);
      assert.deepEqual(await failed.handle.read(), before);
    }
  });

  it("rejects malformed recording/list/block responses without provider diagnostics", async () => {
    for (const [name, payload] of [
      ["recording.get", null],
      ["recording.get", []],
      ["recording.list", { data: {} }],
      ["recording.list", { data: [null] }],
      ["recording.list", { data: Array.from({ length: 21 }, () => ({})) }],
      ["transcript.get", { source_list: "private" }],
      ["summary.get", { note_list: ["private"] }],
      ["note.list", { note_list: {} }],
    ] as const) {
      mock(() => Response.json(payload));
      await assert.rejects(execute(name, { id: "id" }), {
        code: "invalid_response",
        message: "Invalid provider response",
      });
    }
  });

  it("pins destinations, rejects hostile recording IDs and uses the fixed probe", async () => {
    let calls = 0;
    mock((url, init) => {
      calls++;
      assert.equal(url, `${apiBase}users/current`);
      assert.equal(init.redirect, "error");
      return Response.json({});
    });
    for (const id of [
      "..",
      "../users/current",
      "%2e%2e",
      "a/b",
      "https://evil.test",
    ])
      await assert.rejects(execute("recording.get", { id }), {
        code: "request_not_allowed",
      });
    assert.equal(calls, 0);
    const { binding, transport } = plaudRuntime((await context()).ctx);
    assert.deepEqual(await transport.probe(binding), {
      outcome: "accepted",
      status: 200,
    });
    assert.equal(calls, 1);
    for (const id of ["a?b=c", "a#b", "with space"]) {
      mock((url) => {
        assert.equal(url, `${apiBase}files/${encodeURIComponent(id)}`);
        assert.equal(new URL(url).search, "");
        assert.equal(new URL(url).hash, "");
        return Response.json({ id });
      });
      assert.deepEqual(await execute("recording.get", { id }), { id });
    }
  });

  it("preserves list pagination and bounds case-insensitive name scans with honest truncation", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: i === 99 ? "Roadmap REVIEW" : "Other",
      created_at: "2026-01-01 12:00:00",
    }));
    const seen: string[] = [];
    mock((url) => {
      seen.push(url);
      const page = new URL(url).searchParams.get("page");
      if (new URL(url).searchParams.get("page_size") === "20")
        return Response.json({ page: 3, data: [], extra: "kept" });
      return Response.json({
        page: Number(page),
        data:
          page === "1"
            ? first
            : [
                {
                  id: "100",
                  name: "review",
                  created_at: "2026-01-02T00:00:00Z",
                },
              ],
      });
    });
    assert.deepEqual(await execute("recording.list", { page: 3 }), {
      page: 3,
      data: [],
      extra: "kept",
    });
    const result = await execute("recording.search", {
      query: "REVIEW",
      from: "2026-01-01",
      to: "2026-01-01",
    });
    assert.deepEqual(result, {
      recordings: [first[99]],
      scanned: 101,
      pagesScanned: 2,
      truncated: false,
    });
    assert.deepEqual(
      await execute("recording.search", { query: "review", maxPages: 1 }),
      {
        recordings: [first[99]],
        scanned: 100,
        pagesScanned: 1,
        truncated: true,
      },
    );
    assert.deepEqual(
      await execute("recording.search", { query: "review", limit: 1 }),
      {
        recordings: [first[99]],
        scanned: 100,
        pagesScanned: 1,
        truncated: true,
      },
    );
    const before = seen.length;
    await assert.rejects(
      execute("recording.search", { query: "a", from: "2026-02-30" }),
      /invalid date/,
    );
    await assert.rejects(
      execute("recording.search", {
        query: "a",
        from: "2026-02-01",
        to: "2026-01-01",
      }),
      /from must not be after/,
    );
    assert.equal(seen.length, before);
  });

  it("filters recent recordings without assuming page order and deduplicates moved records", async () => {
    const recent = {
      id: "recent",
      name: "recent",
      created_at: new Date().toISOString(),
    };
    mock(() =>
      Response.json({
        data: [
          { id: "old", created_at: "2000-01-01" },
          recent,
          { id: "unknown" },
          recent,
        ],
      }),
    );
    assert.deepEqual(await execute("recording.recent", {}), {
      recordings: [recent],
      scanned: 4,
      pagesScanned: 1,
      truncated: false,
    });
  });

  it("uses UTC and rejects normalized or ambiguous provider timestamps in bounded date scans", async () => {
    const dates = [
      "2026-03-01",
      "2026-03-01 12:30:00",
      "2026-03-01T12:30:00.123Z",
      "2026-02-28T23:30:00-01:00",
      "2026-03-02T00:30:00+0100",
      "2026-02-30T12:00:00",
      "2026-02-29",
      "2026-03-01T24:00:00",
      "March 1, 2026",
      "2026-03-01T12:99:00Z",
      "2026-03-01T23:00:00-02:00",
    ];
    const data = dates.map((created_at, i) => ({
      id: String(i),
      name: "match",
      created_at,
    }));
    mock(() => Response.json({ data }));
    const result = await execute("recording.search", {
      query: "match",
      from: "2026-03-01",
      to: "2026-03-01",
    });
    assert.deepEqual(result, {
      recordings: data.slice(0, 5),
      scanned: data.length,
      pagesScanned: 1,
      truncated: false,
    });
    for (const created_at of ["2024-02-29", "2024-02-29T12:00:00Z"]) {
      mock(() =>
        Response.json({ data: [{ id: "leap", name: "match", created_at }] }),
      );
      const leap = (await execute("recording.search", {
        query: "match",
        from: "2024-02-29",
        to: "2024-02-29",
      })) as { recordings: unknown[] };
      assert.equal(leap.recordings.length, 1);
    }
  });

  it("returns inline transcript variants, multiple summaries, raw notes and audio URLs without link fetches", async () => {
    const sources = [
      {
        data_type: "transaction",
        data_content: JSON.stringify([
          { start_time: 1000, end_time: 2000, speaker: "A", content: "Hello" },
        ]),
        data_link: "https://evil.test/ignored",
      },
      { data_type: "transaction_polish", data_content: "Hello, cleaned." },
      { data_type: "mark_memo", data_content: '{"highlights":["moment"]}' },
    ];
    const notes = [
      { data_type: "auto_sum_note", data_content: "# First" },
      { data_type: "other_note", data_content: "Other" },
      { data_type: "auto_sum_note", data_content: "# Second" },
    ];
    let calls = 0;
    mock((url) => {
      calls++;
      assert.equal(url, `${apiBase}files/id`);
      return Response.json({
        id: "id",
        source_list: sources,
        note_list: notes,
        presigned_url: "https://audio.test/signed?secret=1",
      });
    });
    const transcript = (await execute("transcript.get", {
      id: "id",
    })) as Record<string, unknown>;
    assert.equal(transcript.status, "available");
    assert.deepEqual(transcript.content, JSON.parse(sources[0].data_content));
    assert.equal(
      (
        (await execute("transcript.get", {
          id: "id",
          block: "transaction_polish",
        })) as Record<string, unknown>
      ).content,
      "Hello, cleaned.",
    );
    assert.equal(
      (
        (await execute("transcript.get", {
          id: "id",
          block: "outline",
        })) as Record<string, unknown>
      ).status,
      "unavailable",
    );
    assert.deepEqual(await execute("summary.get", { id: "id", index: 1 }), {
      recordingId: "id",
      index: 1,
      count: 2,
      status: "available",
      content: "# Second",
    });
    assert.deepEqual(await execute("note.list", { id: "id" }), {
      recordingId: "id",
      notes,
    });
    assert.deepEqual(await execute("recording.audioUrl", { id: "id" }), {
      recordingId: "id",
      url: "https://audio.test/signed?secret=1",
    });
    assert.equal(calls, 6);
    mock(() => Response.json({ id: "id" }));
    assert.deepEqual(await execute("recording.audioUrl", { id: "id" }), {
      recordingId: "id",
      url: null,
    });
  });

  it("requires exact host approval for linked content, sends no bearer/cookies and blocks redirects", async () => {
    const link = "https://content.test/transcript?signature=secret";
    let downloads = 0;
    mock((url, init) => {
      if (url.startsWith(apiBase))
        return Response.json({
          source_list: [{ data_type: "transaction", data_link: link }],
        });
      downloads++;
      assert.equal(url, link);
      assert.equal(new Headers(init.headers).has("authorization"), false);
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "error");
      return new Response('[{"content":"linked"}]');
    });
    for (const origins of [undefined, [], ["https://content.test.evil.test"]]) {
      const result = (await execute(
        "transcript.get",
        { id: "id" },
        { contentOrigins: origins },
      )) as Record<string, unknown>;
      assert.equal(result.status, "link_requires_approval");
      assert.equal(result.contentUrl, link);
    }
    assert.equal(downloads, 0);
    const result = (await execute(
      "transcript.get",
      { id: "id" },
      { contentOrigins: ["https://content.test"] },
    )) as Record<string, unknown>;
    assert.deepEqual(result.content, [{ content: "linked" }]);
    assert.equal(downloads, 1);
    mock((url) =>
      url.startsWith(apiBase)
        ? Response.json({
            note_list: [{ data_type: "auto_sum_note", data_link: link }],
          })
        : new Response(null, {
            status: 302,
            headers: { location: "https://private.test" },
          }),
    );
    await assert.rejects(
      execute(
        "summary.get",
        { id: "id" },
        { contentOrigins: ["https://content.test"] },
      ),
      { code: "transport_failed" },
    );
  });

  it("bounds linked response size and rejects malformed content policy without secret-bearing errors", async () => {
    const link = "https://content.test/private?signature=secret";
    mock((url) =>
      url.startsWith(apiBase)
        ? Response.json({
            note_list: [{ data_type: "auto_sum_note", data_link: link }],
          })
        : new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
    );
    await assert.rejects(
      execute(
        "summary.get",
        { id: "id" },
        { contentOrigins: ["https://content.test"] },
      ),
      { code: "response_too_large" },
    );
    for (const policy of [
      "https://content.test",
      ["https://content.test/path"],
      ["http://content.test"],
      ["https://user:secret@content.test"],
      [null],
    ])
      await assert.rejects(
        execute("summary.get", { id: "id" }, { contentOrigins: policy }),
        { code: "invalid_credentials" },
      );
    for (const data_link of [
      "http://private.test",
      "https://user:secret@content.test",
      "https://content.test/#secret",
    ]) {
      mock(() =>
        Response.json({
          note_list: [{ data_type: "auto_sum_note", data_link }],
        }),
      );
      await assert.rejects(execute("summary.get", { id: "id" }), {
        code: "request_not_allowed",
      });
    }
  });
});
