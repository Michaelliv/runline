import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import nextcloud from "../../../runline-plugins/nextcloud/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const config = {
  webDavUrl: "https://cloud.example.com/sub/remote.php/webdav/",
  username: "u",
  password: "p",
};

function run(
  action: string,
  input: Record<string, unknown>,
  connection: Record<string, unknown> = config,
) {
  const { api, resolve } = createPluginAPI("nextcloud");
  nextcloud(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "nc", plugin: "nextcloud", config: connection },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

type Seen = {
  url: string;
  method?: string;
  destination: string | null;
  ocs: string | null;
  body?: string;
};

function capture(
  reply: () => Response = () => new Response(null, { status: 201 }),
) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(url),
      method: init?.method,
      destination: headers.get("destination"),
      ocs: headers.get("ocs-apirequest"),
      body: init?.body
        ? new TextDecoder().decode(init.body as Uint8Array)
        : undefined,
    });
    return reply();
  }) as typeof fetch;
  return seen;
}

describe("nextcloud", () => {
  it("moves a file with a Destination beneath the same WebDAV base", async () => {
    const seen = capture();
    await run("file.move", {
      path: "/invoices/a b.txt",
      toPath: "/archive/a b.txt",
    });
    assert.deepEqual(seen, [
      {
        url: "https://cloud.example.com/sub/remote.php/webdav/invoices/a%20b.txt",
        method: "MOVE",
        destination:
          "https://cloud.example.com/sub/remote.php/webdav/archive/a%20b.txt",
        ocs: null,
        body: undefined,
      },
    ]);
  });

  it("refuses a destination that climbs out of the WebDAV base, before any request", async () => {
    const seen = capture();
    await assert.rejects(
      run("folder.copy", { path: "/a", toPath: "/../../etc" }),
      { code: "request_not_allowed" },
    );
    assert.equal(seen.length, 0);
  });

  it("calls OCS on the server root, with its request header, JSON format and a form body", async () => {
    const seen = capture(() =>
      Response.json({
        ocs: { meta: { status: "ok", statuscode: 100 }, data: {} },
      }),
    );
    await run("user.update", {
      userId: "jane doe",
      key: "email",
      value: "j@x.io",
    });
    assert.deepEqual(seen, [
      {
        url: "https://cloud.example.com/sub/ocs/v1.php/cloud/users/jane%20doe?format=json",
        method: "PUT",
        destination: null,
        ocs: "true",
        body: "key=email&value=j%40x.io",
      },
    ]);
  });

  it("reports an OCS failure by its status code, never its message", async () => {
    capture(() =>
      Response.json({
        ocs: {
          meta: {
            status: "failure",
            statuscode: 102,
            message: "private user exists",
          },
        },
      }),
    );
    await assert.rejects(
      run("user.create", { userId: "jane", email: "j@x.io" }),
      {
        message: "nextcloud: request failed (102)",
      },
    );
  });

  it("refuses a WebDAV URL it cannot find the server root in", async () => {
    capture();
    await assert.rejects(
      run(
        "folder.create",
        { path: "/a" },
        { ...config, webDavUrl: "https://cloud.example.com/dav" },
      ),
      { code: "invalid_credentials" },
    );
  });
});
