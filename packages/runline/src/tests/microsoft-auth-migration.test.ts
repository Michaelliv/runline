import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  graphRequest,
  graphResponse,
  microsoftDownload,
  microsoftProbe,
  userBase,
} from "../../../runline-plugins/_shared/microsoftAuth.js";
import microsoftCalendar from "../../../runline-plugins/microsoftCalendar/src/index.js";
import microsoftFiles from "../../../runline-plugins/microsoftFiles/src/index.js";
import microsoftMail from "../../../runline-plugins/microsoftMail/src/index.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function mock(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (url, init) =>
    handler(String(url), init ?? {})) as typeof fetch;
}
async function context(config: Record<string, unknown> = {}) {
  const store = new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "microsoft",
      config: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "r1",
        accessToken: "old",
        ...config,
      },
    },
  ]);
  const handle = await store.resolve({ plugin: "microsoft" });
  const connection = await handle.read();
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
  return { ctx, store, handle };
}
function action(plugin: PluginFunction, name: string) {
  const { api, resolve } = createPluginAPI("test");
  plugin(api);
  const result = resolve().actions.find((a) => a.name === name);
  assert.ok(result);
  return result;
}

describe("Microsoft credential migration", () => {
  it("migrates every Graph consumer onto one-replay reads without retrying writes", async () => {
    for (const spec of [
      {
        plugin: microsoftMail,
        name: "mail.list",
        input: {},
        result: { value: [] },
      },
      {
        plugin: microsoftCalendar,
        name: "calendar.list",
        input: { start: "2026-01-01", end: "2026-01-02" },
        result: { value: [] },
      },
      {
        plugin: microsoftFiles,
        name: "files.list",
        input: {},
        result: { value: [] },
      },
    ]) {
      const { ctx } = await context();
      const calls: string[] = [];
      mock((url, init) => {
        calls.push(url);
        assert.equal(init.redirect, "error");
        if (url.includes("login.microsoftonline.com"))
          return Response.json({ access_token: "new", refresh_token: "r2" });
        return new Headers(init.headers).get("authorization") === "Bearer old"
          ? new Response(null, { status: 401 })
          : Response.json(spec.result);
      });
      assert.deepEqual(
        await action(spec.plugin, spec.name).execute(spec.input, ctx),
        [],
      );
      assert.equal(calls.length, 3);
      assert.equal(ctx.connection.config.refreshToken, "r2");
      assert.equal(typeof ctx.connection.config.authTokenRevision, "string");
    }
    const { ctx } = await context();
    let calls = 0;
    mock(() => {
      calls++;
      return new Response("private-error", { status: 401 });
    });
    await assert.rejects(
      action(microsoftMail, "mail.send").execute(
        { to: ["x@example.com"], subject: "test", body: "test" },
        ctx,
      ) as Promise<unknown>,
      { message: "microsoftMail: Graph request failed (HTTP 401)" },
    );
    assert.equal(calls, 1);
  });

  it("honors explicit methods even when fields from another method remain", async () => {
    const { ctx } = await context({
      authMethod: "appOnly",
      tenantId: "tenant",
      userUpn: "user@example.com",
      accessToken: undefined,
    });
    assert.equal(userBase(ctx), "/users/user%40example.com");
    mock((url, init) => {
      if (url.includes("login.microsoftonline.com")) {
        const fields = new URLSearchParams(String(init.body));
        assert.equal(fields.get("grant_type"), "client_credentials");
        assert.equal(fields.has("refresh_token"), false);
        return Response.json({ access_token: "app" });
      }
      return Response.json({});
    });
    await graphRequest(
      ctx,
      "microsoftMail",
      [],
      "GET",
      "/users/user%40example.com/messages",
    );
    const delegated = await context({
      authMethod: "delegated",
      tenantId: "tenant",
      userUpn: "unused",
    });
    assert.equal(userBase(delegated.ctx), "/me");
    const invalid = await context({ authMethod: "unknown" });
    await assert.rejects(
      graphRequest(invalid.ctx, "microsoftMail", [], "GET", "/me"),
      { code: "invalid_credentials" },
    );
  });

  it("uses scope-appropriate probes for delegated, app-only and selected drives", async () => {
    const seen: string[] = [];
    mock((url) => {
      seen.push(url);
      return Response.json({});
    });
    const { ctx } = await context();
    for (const plugin of [
      "microsoftMail",
      "microsoftCalendar",
      "microsoftFiles",
    ]) {
      assert.equal((await microsoftProbe(ctx, plugin, [])).outcome, "accepted");
    }
    assert.ok(seen[0].includes("/me/messages?"));
    assert.ok(seen[1].includes("/me/events?"));
    assert.ok(seen[2].includes("/me/drive/root?"));
    const app = await context({
      authMethod: "appOnly",
      tenantId: "tenant",
      driveId: "library",
    });
    await microsoftProbe(app.ctx, "microsoftFiles", []);
    assert.ok(seen[3].includes("/drives/library/root?"));
    assert.deepEqual(await microsoftProbe(app.ctx, "microsoftMail", []), {
      outcome: "unverified",
    });
  });

  it("downloads Graph-issued signed URLs without credentials and preserves uploads with encoded spaces", async () => {
    const { ctx } = await context();
    const calls: string[] = [];
    mock((url, init) => {
      calls.push(url);
      if (url.includes("sharepoint.com")) {
        assert.equal(new Headers(init.headers).has("authorization"), false);
        assert.equal(init.credentials, "omit");
        assert.equal(init.redirect, "error");
        return new Response("file bytes");
      }
      if (init.method === "PUT") {
        assert.ok(url.includes("Agent%20Output/report.docx"));
        assert.equal(Buffer.from(init.body as Uint8Array).toString(), "upload");
        return Response.json({ id: "uploaded" });
      }
      return Response.json({
        id: "item",
        name: "doc",
        "@microsoft.graph.downloadUrl":
          "https://tenant.sharepoint.com/download?secret=signed",
      });
    });
    const downloaded = (await action(microsoftFiles, "files.get").execute(
      { id: "item" },
      ctx,
    )) as { base64: string };
    assert.equal(
      Buffer.from(downloaded.base64, "base64").toString(),
      "file bytes",
    );
    await action(microsoftFiles, "files.upload").execute(
      {
        path: "Agent Output/report.docx",
        base64: Buffer.from("upload").toString("base64"),
      },
      ctx,
    );
    assert.equal(calls.length, 3);
    for (const url of [
      "https://evil.example/download",
      "https://sharepoint.com.evil.example/",
      "http://tenant.sharepoint.com/",
      "https://user:password@tenant.sharepoint.com/",
    ])
      await assert.rejects(microsoftDownload(url), {
        code: "request_not_allowed",
      });
    assert.equal(calls.length, 3);
  });

  it("rejects token routing changes while waiting for update ownership", async () => {
    const { ctx, handle } = await context({ accessTokenExpiresAt: 1 });
    await handle.update({ clientId: "another-app" });
    let calls = 0;
    mock(() => {
      calls++;
      return Response.json({});
    });
    await assert.rejects(
      graphResponse(ctx, "microsoftMail", [], "GET", "/me/messages"),
      { code: "credential_store_failed" },
    );
    assert.equal(calls, 0);
  });

  it("does not reuse a cached token after an explicit method change", async () => {
    const h = await context({ accessToken: undefined });
    let acquisitions = 0;
    mock((url) => {
      if (url.includes("login.microsoftonline.com")) {
        acquisitions++;
        return Response.json({ access_token: `issued-${acquisitions}` });
      }
      return Response.json({});
    });
    await graphResponse(h.ctx, "microsoftMail", [], "GET", "/me/messages");
    await h.ctx.updateConnection({
      authMethod: "appOnly",
      tenantId: "tenant",
      userUpn: "user",
    });
    await graphResponse(
      h.ctx,
      "microsoftMail",
      [],
      "GET",
      "/users/user/messages",
    );
    assert.equal(acquisitions, 2);
  });
});
