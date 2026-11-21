import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import dropbox, {
  apiArg,
  errorCode,
} from "../../../codemode-plugins/dropbox/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
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
const bearer = () => context({ accessToken: "t" }).ctx;

/** Answers each request with the next response, the last one repeating. */
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
    return responses[Math.min(calls.length, responses.length) - 1]();
  });
  return calls;
}
const header = (init: RequestInit, name: string) =>
  new Headers(init.headers).get(name);
const json = (call: { body: string }) => JSON.parse(call.body);
const run = (name: string, input: unknown, ctx: ActionContext) =>
  getAction(plugin, name).execute(input, ctx);
/** The engine's verdict on an input, normalization included. */
const valid = (name: string, input: unknown) =>
  validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;

describe("dropbox inputs", () => {
  it("takes only the upload modes the action supports", () => {
    const upload = { localPath: "/tmp/a", path: "/a" };
    assert.ok(valid("file.upload", { ...upload, mode: "overwrite" }));
    assert.equal(valid("file.upload", { ...upload, mode: "update" }), false);
  });

  it("refuses unknown fields and unknown search categories", () => {
    assert.equal(valid("file.get", { path: "/a", rev: "1" }), false);
    assert.ok(
      valid("search.query", { query: "q", fileCategories: ["others"] }),
    );
    assert.equal(
      valid("search.query", { query: "q", fileCategories: ["other"] }),
      false,
    );
  });
});

describe("dropbox credential", () => {
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

  it("refuses to refresh without the app secret", async () => {
    const calls = mock([() => Response.json({})]);
    const { ctx } = context({ clientId: "app_key", refreshToken: "r" });
    await assert.rejects(run("account.get", {}, ctx), {
      code: "invalid_credentials",
    });
    assert.equal(calls.length, 0);
  });

  it("signs with a pasted access token and no refresh token", async () => {
    const calls = mock([() => Response.json({})]);
    await run("account.get", {}, context({ accessToken: "sl.pasted" }).ctx);
    assert.equal(calls.length, 1);
    assert.equal(header(calls[0].init, "authorization"), "Bearer sl.pasted");
  });

  it("signs with the pasted token when authMethod says bearer", async () => {
    const calls = mock([() => Response.json({})]);
    const { ctx } = context({
      ...oauth,
      authMethod: "bearer",
      accessToken: "sl.pasted",
    });
    await run("account.get", {}, ctx);
    assert.equal(calls.length, 1);
    assert.equal(header(calls[0].init, "authorization"), "Bearer sl.pasted");
  });
});

describe("dropbox failures", () => {
  it("reads Dropbox's error union as a dotted tag path", () => {
    assert.equal(
      errorCode({
        error_summary: "path/not_found/..",
        error: { ".tag": "path", path: { ".tag": "not_found" } },
      }),
      "path.not_found",
    );
    assert.equal(errorCode({ error: { ".tag": "other" } }), "other");
    assert.equal(errorCode({ error_summary: "x/" }), undefined);
    assert.equal(errorCode(null), undefined);
  });

  it("reports the status and the error code, never the summary text", async () => {
    mock([
      () =>
        Response.json(
          {
            error_summary: "path/not_found/..",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          },
          { status: 409 },
        ),
    ]);
    await assert.rejects(run("file.get", { path: "/nope" }, bearer()), {
      message: "dropbox: request failed (HTTP 409 path.not_found)",
      status: 409,
    });
  });

  it("reports a content call's failure the same way", async () => {
    mock([
      () =>
        Response.json(
          { error: { ".tag": "path", path: { ".tag": "not_file" } } },
          { status: 409 },
        ),
    ]);
    await assert.rejects(run("file.download", { path: "/dir" }, bearer()), {
      message: "dropbox: request failed (HTTP 409 path.not_file)",
      status: 409,
    });
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
      bearer(),
    );
    assert.equal(
      calls[0].url.href,
      "https://content.dropboxapi.com/2/files/upload",
    );
    assert.equal(calls[0].body, "hello");
    assert.equal(
      header(calls[0].init, "content-type"),
      "application/octet-stream",
    );
    assert.deepEqual(
      JSON.parse(header(calls[0].init, "dropbox-api-arg") ?? ""),
      { path: "/x/a.txt", mode: "overwrite", autorename: false, mute: true },
    );
    assert.deepEqual(result, { name: "a.txt", size: 5 });
  });

  it("downloads to savePath, named by the metadata header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dbx-"));
    const out = join(dir, "b.bin");
    const calls = mock([
      () =>
        new Response(Buffer.from([1, 2, 3]), {
          headers: {
            "Dropbox-API-Result": JSON.stringify({ name: "b.bin" }),
          },
        }),
    ]);
    const result = await run(
      "file.download",
      { path: "/b.bin", savePath: out },
      bearer(),
    );
    assert.equal(
      calls[0].url.href,
      "https://content.dropboxapi.com/2/files/download",
    );
    assert.deepEqual([...readFileSync(out)], [1, 2, 3]);
    assert.deepEqual(result, { path: out, name: "b.bin", size: 3 });
  });

  it("downloads as base64 without savePath", async () => {
    mock([
      () =>
        new Response(Buffer.from("hi"), {
          headers: { "Dropbox-API-Result": '{"name":"h.txt"}' },
        }),
    ]);
    assert.deepEqual(await run("file.download", { path: "/h.txt" }, bearer()), {
      name: "h.txt",
      size: 2,
      contentBase64: Buffer.from("hi").toString("base64"),
    });
  });
});

describe("dropbox share links", () => {
  it("returns the existing link without creating one", async () => {
    const link = { url: "https://www.dropbox.com/s/a" };
    const calls = mock([() => Response.json({ links: [link] })]);
    assert.deepEqual(
      await run("file.shareLink", { path: "/a" }, bearer()),
      link,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(json(calls[0]), { path: "/a", direct_only: true });
  });

  it("creates a link when there is none", async () => {
    const link = { url: "https://www.dropbox.com/s/b" };
    const calls = mock([
      () => Response.json({ links: [] }),
      () => Response.json(link),
    ]);
    assert.deepEqual(
      await run("file.shareLink", { path: "/b" }, bearer()),
      link,
    );
    assert.equal(
      calls[1].url.pathname,
      "/2/sharing/create_shared_link_with_settings",
    );
    assert.deepEqual(json(calls[1]), { path: "/b" });
  });
});

describe("dropbox listings", () => {
  it("pages a folder by cursor and stops at the limit", async () => {
    const calls = mock([
      () => Response.json({ entries: [1, 2], has_more: true, cursor: "c1" }),
      () => Response.json({ entries: [3, 4], has_more: true, cursor: "c2" }),
    ]);
    const result = await run(
      "folder.list",
      { path: "", limit: 3, recursive: true },
      bearer(),
    );
    assert.deepEqual(result, [1, 2, 3]);
    assert.equal(calls.length, 2);
    assert.deepEqual(json(calls[0]), {
      path: "",
      limit: 1000,
      recursive: true,
    });
    assert.equal(calls[1].url.pathname, "/2/files/list_folder/continue");
    assert.deepEqual(json(calls[1]), { cursor: "c1" });
  });

  it("searches by name with the options Dropbox takes", async () => {
    const calls = mock([
      () => Response.json({ matches: [{ m: 1 }], has_more: false }),
    ]);
    await run(
      "search.query",
      {
        query: "report",
        limit: 5,
        path: "/docs",
        fileCategories: ["pdf"],
        fileStatus: "deleted",
      },
      bearer(),
    );
    assert.equal(calls[0].url.pathname, "/2/files/search_v2");
    assert.deepEqual(json(calls[0]), {
      query: "report",
      options: {
        filename_only: true,
        max_results: 5,
        path: "/docs",
        file_categories: ["pdf"],
        file_status: { ".tag": "deleted" },
      },
    });
  });
});
