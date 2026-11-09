import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import dropbox, { apiArg } from "../../../runline-plugins/dropbox/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("dropbox");
dropbox(api);
const plugin = resolve();

/** A connection whose updates commit, as a store's would. */
function context(config: Record<string, unknown>) {
  const connection = { name: "dbx", plugin: "dropbox", config };
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) connection.config = { ...connection.config, ...patch };
    },
  };
  return { ctx, connection };
}
const oauth = {
  clientId: "app_key",
  clientSecret: "app_secret",
  refreshToken: "long_refresh",
};

function mock(responses: Array<() => Response>) {
  const calls: { url: URL; init: RequestInit; body: string }[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    calls.push({
      url: new URL(String(url)),
      init: init ?? {},
      body:
        body === undefined || body === null
          ? ""
          : Buffer.from(body as Uint8Array).toString(),
    });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    return next();
  });
  return calls;
}
const header = (init: RequestInit, name: string) =>
  new Headers(init.headers).get(name);
const run = (name: string, input: unknown, ctx: ActionContext) =>
  getAction(plugin, name).execute(input, ctx);

describe("dropbox refresh token", () => {
  it("renews an access token at Dropbox's token endpoint and stores it", async () => {
    const calls = mock([
      () =>
        Response.json({
          access_token: "sl.fresh",
          expires_in: 14400,
          token_type: "bearer",
        }),
      () => Response.json({ account_id: "dbid:1" }),
    ]);
    const { ctx, connection } = context(oauth);
    await run("account.get", {}, ctx);
    assert.equal(calls[0].url.href, "https://api.dropboxapi.com/oauth2/token");
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "long_refresh");
    assert.equal(form.get("client_id"), "app_key");
    assert.equal(form.get("client_secret"), "app_secret");
    assert.equal(
      calls[1].url.href,
      "https://api.dropboxapi.com/2/users/get_current_account",
    );
    assert.equal(header(calls[1].init, "authorization"), "Bearer sl.fresh");
    assert.equal(connection.config.accessToken, "sl.fresh");
    // The refresh token survives a renewal that does not rotate it.
    assert.equal(connection.config.refreshToken, "long_refresh");
  });

  it("reuses a stored token until it expires", async () => {
    const calls = mock([() => Response.json({ account_id: "dbid:1" })]);
    const { ctx } = context({
      ...oauth,
      accessToken: "sl.current",
      accessTokenExpiresAt: Date.now() + 3_600_000,
    });
    await run("account.get", {}, ctx);
    assert.equal(calls.length, 1);
    assert.equal(header(calls[0].init, "authorization"), "Bearer sl.current");
  });

  it("refreshes a PKCE client with its client ID alone", async () => {
    const calls = mock([
      () => Response.json({ access_token: "sl.pkce", expires_in: 14400 }),
      () => Response.json({}),
    ]);
    const { ctx } = context({ clientId: "app_key", refreshToken: "r" });
    await run("account.get", {}, ctx);
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get("client_id"), "app_key");
    assert.equal(form.get("client_secret"), null);
    assert.equal(header(calls[0].init, "authorization"), null);
  });

  it("still signs with a pasted access token and no refresh token", async () => {
    const calls = mock([() => Response.json({})]);
    await run("account.get", {}, context({ accessToken: "sl.pasted" }).ctx);
    assert.equal(calls.length, 1);
    assert.equal(header(calls[0].init, "authorization"), "Bearer sl.pasted");
  });
});

describe("dropbox content", () => {
  it("escapes non-ASCII in Dropbox-API-Arg", () => {
    assert.equal(
      apiArg({ path: "/דוח.pdf" }),
      '{"path":"/\\u05d3\\u05d5\\u05d7.pdf"}',
    );
    assert.deepEqual(JSON.parse(apiArg({ path: "/דוח.pdf" })), {
      path: "/דוח.pdf",
    });
  });

  it("uploads bytes to the content host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbx-"));
    const file = join(dir, "a.txt");
    writeFileSync(file, "hello");
    const calls = mock([() => Response.json({ name: "a.txt", size: 5 })]);
    const result = await run(
      "file.upload",
      { localPath: file, path: "/x/a.txt", mode: "overwrite" },
      context({ accessToken: "t" }).ctx,
    );
    assert.equal(
      calls[0].url.href,
      "https://content.dropboxapi.com/2/files/upload",
    );
    assert.equal(calls[0].body, "hello");
    assert.deepEqual(
      JSON.parse(header(calls[0].init, "dropbox-api-arg") ?? ""),
      {
        path: "/x/a.txt",
        mode: "overwrite",
        autorename: false,
        mute: true,
      },
    );
    assert.deepEqual(result, { name: "a.txt", size: 5 });
  });

  it("downloads to savePath with the metadata header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbx-"));
    const out = join(dir, "b.bin");
    mock([
      () =>
        new Response(Buffer.from([1, 2, 3]), {
          headers: {
            "Dropbox-API-Result": JSON.stringify({
              name: "b.bin",
              path_display: "/b.bin",
            }),
          },
        }),
    ]);
    const result = await run(
      "file.download",
      { path: "/b.bin", savePath: out },
      context({ accessToken: "t" }).ctx,
    );
    assert.deepEqual([...readFileSync(out)], [1, 2, 3]);
    assert.deepEqual(result, {
      path: out,
      name: "b.bin",
      size: 3,
      dropboxPath: "/b.bin",
    });
  });
});
