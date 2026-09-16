import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import {
  googleDownload,
  googleProbe,
  googleResponse,
} from "../../../runline-plugins/_shared/googleAuth.js";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import googleAppsScript from "../../../runline-plugins/googleAppsScript/src/index.js";
import googleCalendar from "../../../runline-plugins/googleCalendar/src/index.js";
import googleContacts from "../../../runline-plugins/googleContacts/src/index.js";
import googleDocs from "../../../runline-plugins/googleDocs/src/index.js";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import googleSheets from "../../../runline-plugins/googleSheets/src/index.js";
import googleSlides from "../../../runline-plugins/googleSlides/src/index.js";
import googleTasks from "../../../runline-plugins/googleTasks/src/index.js";
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
async function context() {
  const store = new MemoryConnectionProvider([
    {
      name: "account",
      plugin: "google",
      config: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "r1",
        accessToken: "old",
      },
    },
  ]);
  const handle = await store.resolve({ plugin: "google" });
  const connection = await handle.read();
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
  return ctx;
}
function action(plugin: PluginFunction, name: string) {
  const { api, resolve } = createPluginAPI("test");
  plugin(api);
  const found = resolve().actions.find((action) => action.name === name);
  assert.ok(found);
  return found;
}

it("all nine Google consumers durably renew once and replay reads", async () => {
  const specs: Array<[PluginFunction, string, object, object]> = [
    [gmail, "profile.get", {}, {}],
    [googleAppsScript, "project.getContent", { scriptId: "id" }, { files: [] }],
    [googleCalendar, "calendar.list", {}, {}],
    [googleContacts, "contact.get", { contactId: "id" }, {}],
    [googleDocs, "document.get", { document: "id" }, {}],
    [googleDrive, "file.get", { fileId: "id" }, {}],
    [googleSheets, "spreadsheet.get", { spreadsheetId: "id" }, {}],
    [googleSlides, "presentation.get", { presentation: "id" }, {}],
    [googleTasks, "taskList.get", { taskListId: "id" }, {}],
  ];
  for (const [plugin, name, input, result] of specs) {
    const ctx = await context();
    let calls = 0;
    mock((url, init) => {
      calls++;
      assert.equal(init.redirect, "error");
      if (url === "https://oauth2.googleapis.com/token")
        return Response.json({ access_token: "new", refresh_token: "r2" });
      assert.equal(init.credentials, "omit");
      if (new Headers(init.headers).get("authorization") === "Bearer old")
        return new Response("private-error", { status: 401 });
      assert.equal(ctx.connection.config.refreshToken, "r2");
      return Response.json(result);
    });
    await action(plugin, name).execute(input, ctx);
    assert.equal(calls, 3, name);
    assert.equal(typeof ctx.connection.config.authTokenRevision, "string");
  }
});

it("never replays writes or retries quota/server/network failures, and keeps Gmail send guidance", async () => {
  for (const status of [401, 403, 429, 500]) {
    const ctx = await context();
    let calls = 0;
    mock(() => {
      calls++;
      return new Response("SECRET", { status });
    });
    await assert.rejects(
      Promise.resolve(
        action(gmail, "message.send").execute(
          { to: "a@example.com", subject: "test", text: "hello" },
          ctx,
        ),
      ),
      (error: Error) => {
        assert.ok(error.message.includes("Before retrying"));
        assert.ok(!error.message.includes("SECRET"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  for (const status of [403, 429, 500]) {
    let calls = 0;
    mock(() => {
      calls++;
      return new Response("SECRET", { status });
    });
    await assert.rejects(
      Promise.resolve(
        action(googleTasks, "taskList.list").execute({}, await context()),
      ),
    );
    assert.equal(calls, 1);
  }
});

it("network errors are sanitized without automatic retry", async () => {
  let calls = 0;
  mock(() => {
    calls++;
    throw new Error("SECRET URL");
  });
  await assert.rejects(
    Promise.resolve(
      action(googleDrive, "file.get").execute(
        { fileId: "id" },
        await context(),
      ),
    ),
    {
      code: "transport_failed",
      message: "Authenticated request failed; remote outcome may be unknown",
    },
  );
  assert.equal(calls, 1);
});

it("rejects unapproved destinations, traversal, credential headers, and cross-plugin targets before IO", async () => {
  let calls = 0;
  mock(() => {
    calls++;
    return Response.json({});
  });
  const ctx = await context();
  for (const url of [
    "https://evil.example/",
    "https://sheets.googleapis.com.evil.example/v4/",
    "https://sheets.googleapis.com/v4/../v4/spreadsheets",
    "https://sheets.googleapis.com/v4/%2e%2e/v4/spreadsheets",
    "https://sheets.googleapis.com/v4/spreadsheets?access_token=secret",
    "https://www.googleapis.com/upload/drive/v3/files",
  ])
    await assert.rejects(googleResponse(ctx, "googleSheets", [], url), {
      code: "request_not_allowed",
    });
  await assert.rejects(
    googleResponse(
      ctx,
      "googleSheets",
      [],
      "https://sheets.googleapis.com/v4/spreadsheets",
      { headers: { Authorization: "Bearer secret" } },
    ),
    { code: "request_not_allowed" },
  );
  assert.equal(calls, 0);
});

it("preserves repeated query values, opaque pagination tokens, and encoded A1 spaces", async () => {
  const ctx = await context();
  let calls = 0;
  mock((value) => {
    const url = new URL(value);
    calls++;
    if (url.hostname === "sheets.googleapis.com") {
      assert.ok(url.pathname.includes("My%20Sheet"));
      return Response.json({ values: [["value"]] });
    }
    if (calls === 2)
      return Response.json({
        items: [{ id: "one" }],
        nextPageToken: "opaque+/=?&",
      });
    assert.equal(url.searchParams.get("pageToken"), "opaque+/=?&");
    return Response.json({ items: [{ id: "two" }] });
  });
  assert.deepEqual(
    await action(googleSheets, "sheet.read").execute(
      { spreadsheetId: "id", range: "My Sheet!A1:B2" },
      ctx,
    ),
    [["value"]],
  );
  assert.deepEqual(
    await action(googleTasks, "taskList.list").execute(
      { returnAll: true },
      ctx,
    ),
    [{ id: "one" }, { id: "two" }],
  );
  mock((value) => {
    assert.deepEqual(new URL(value).searchParams.getAll("metadataHeaders"), [
      "From",
      "To",
    ]);
    return Response.json({});
  });
  await action(gmail, "message.get").execute(
    { id: "id", format: "metadata", metadataHeaders: ["From", "To"] },
    ctx,
  );
});

it("People colon operations remain valid and Google probes never invent a document ID", async () => {
  const seen: string[] = [];
  mock((url) => {
    seen.push(url);
    return Response.json({});
  });
  const ctx = await context();
  await action(googleContacts, "contact.create").execute(
    { givenName: "Name" },
    ctx,
  );
  assert.equal(
    seen[0],
    "https://people.googleapis.com/v1/people:createContact",
  );
  for (const plugin of [
    "googleDrive",
    "googleTasks",
    "googleContacts",
    "googleCalendar",
    "gmail",
    "googleAppsScript",
  ])
    assert.equal((await googleProbe(ctx, plugin, [])).outcome, "accepted");
  for (const plugin of ["googleDocs", "googleSheets", "googleSlides"])
    assert.deepEqual(await googleProbe(ctx, plugin, []), {
      outcome: "unverified",
    });
  assert.equal(seen.length, 7);
});

it("Slides downloads signed thumbnails without bearer tokens and rejects hostile hosts", async () => {
  mock((url, init) => {
    if (url.startsWith("https://slides.googleapis.com/"))
      return Response.json({
        contentUrl: "https://lh3.googleusercontent.com/signed?secret=value",
      });
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(init.credentials, "omit");
    return new Response("image");
  });
  const result = (await action(googleSlides, "page.getThumbnail").execute(
    { presentation: "id", pageObjectId: "page", download: true },
    await context(),
  )) as { contentBase64: string };
  assert.equal(Buffer.from(result.contentBase64, "base64").toString(), "image");
  for (const url of [
    "https://evil.example/",
    "https://googleusercontent.com.evil.example/",
    "http://lh3.googleusercontent.com/",
    "https://user:pass@lh3.googleusercontent.com/",
  ])
    await assert.rejects(googleDownload(url), { code: "request_not_allowed" });
});

it("Drive binary downloads, exports, revision restores, and multipart uploads use shared transport", async () => {
  const ctx = await context();
  const methods: string[] = [];
  mock((value, init) => {
    const url = new URL(value);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer old");
    assert.equal(new Headers(init.headers).has("content-length"), false);
    assert.equal(init.redirect, "error");
    methods.push(init.method ?? "GET");
    if (
      url.searchParams.get("alt") === "media" ||
      url.pathname.endsWith("/export")
    )
      return new Response("bytes", {
        headers: { "content-type": "text/plain" },
      });
    if (url.pathname.startsWith("/upload/")) {
      assert.ok(
        Buffer.from(init.body as Uint8Array)
          .toString()
          .includes("bytes"),
      );
      return Response.json({ id: "file" });
    }
    return Response.json({ id: "file", name: "file", mimeType: "text/plain" });
  });
  for (const [name, input] of [
    ["file.download", { fileId: "file" }],
    ["file.export", { fileId: "file", mimeType: "text/plain" }],
    ["revision.download", { fileId: "file", revisionId: "rev" }],
  ] as const) {
    const result = (await action(googleDrive, name).execute(input, ctx)) as {
      contentBase64: string;
    };
    assert.equal(
      Buffer.from(result.contentBase64, "base64").toString(),
      "bytes",
    );
  }
  await action(googleDrive, "revision.restore").execute(
    { fileId: "file", revisionId: "rev" },
    ctx,
  );
  await action(googleDrive, "file.upload").execute({ content: "bytes" }, ctx);
  await action(googleDrive, "file.update").execute(
    { fileId: "file", contentBase64: Buffer.from("bytes").toString("base64") },
    ctx,
  );
  assert.ok(methods.includes("PATCH") && methods.includes("POST"));
});

it("Drive resumable create/update accept 308 acknowledgements but require final completion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runline-google-upload-"));
  const path = join(dir, "large.bin");
  const size = 6 * 1024 * 1024;
  writeFileSync(path, Buffer.alloc(size, 42));
  try {
    for (const name of ["file.upload", "file.update"]) {
      let chunks = 0;
      mock((url, init) => {
        const headers = new Headers(init.headers);
        if (init.method === "PUT") {
          const start = chunks++ * 2 * 1024 * 1024;
          assert.equal(
            headers.get("content-range"),
            `bytes ${start}-${start + 2 * 1024 * 1024 - 1}/${size}`,
          );
          assert.equal((init.body as Uint8Array).byteLength, 2 * 1024 * 1024);
          assert.ok(url.includes("upload_id=session"));
          return chunks < 3
            ? new Response(null, { status: 308 })
            : Response.json({ id: "file" });
        }
        if (url.includes("uploadType=resumable"))
          return new Response(null, {
            headers: {
              location:
                "https://www.googleapis.com/upload/drive/v3/files?upload_id=session",
            },
          });
        return Response.json({ id: "file" });
      });
      await action(googleDrive, name).execute(
        { fileId: "file", contentPath: path },
        await context(),
      );
      assert.equal(chunks, 3);
    }
    mock((_url, init) =>
      init.method === "PUT"
        ? new Response(null, { status: 308 })
        : new Response(null, {
            headers: {
              location:
                "https://www.googleapis.com/upload/drive/v3/files?upload_id=session",
            },
          }),
    );
    await assert.rejects(
      Promise.resolve(
        action(googleDrive, "file.update").execute(
          { fileId: "file", contentPath: path },
          await context(),
        ),
      ),
      /did not complete/,
    );
    let calls = 0;
    mock(() => {
      calls++;
      return new Response(null, {
        headers: { location: "https://evil.example/upload" },
      });
    });
    await assert.rejects(
      Promise.resolve(
        action(googleDrive, "file.upload").execute(
          { contentPath: path },
          await context(),
        ),
      ),
      /invalid resumable session/,
    );
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("service-account resource rejection renews through JWT issuance rather than a stale refresh token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const ctx = await context();
  await ctx.updateConnection({
    authMethod: "serviceAccount",
    serviceAccountEmail: "service@example.com",
    serviceAccountPrivateKey: privateKey,
  });
  let calls = 0;
  mock((url, init) => {
    calls++;
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init.body));
      assert.equal(
        body.get("grant_type"),
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      );
      assert.equal(body.has("refresh_token"), false);
      return Response.json({ access_token: "service-token" });
    }
    return new Headers(init.headers).get("authorization") === "Bearer old"
      ? new Response(null, { status: 401 })
      : Response.json({});
  });
  await action(googleDrive, "file.get").execute({ fileId: "id" }, ctx);
  assert.equal(calls, 3);
  assert.equal(ctx.connection.config.accessToken, "service-token");
});

it("persistence failure stops a read before replay and never exposes the issued token", async () => {
  const ctx = await context();
  ctx.updateConnection = async (change) => {
    if (typeof change === "function") await change(ctx.connection.config);
    throw new Error("STORE-SECRET");
  };
  let calls = 0;
  mock((url) => {
    calls++;
    return url === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "issued-secret" })
      : new Response(null, { status: 401 });
  });
  await assert.rejects(
    Promise.resolve(
      action(googleDrive, "file.get").execute({ fileId: "id" }, ctx),
    ),
    { code: "credential_store_failed" },
  );
  assert.equal(calls, 2);
  assert.equal(ctx.connection.config.accessToken, "old");
});

it("308 with Location is a redirect, not an upload acknowledgement", async () => {
  mock(
    () =>
      new Response(null, {
        status: 308,
        headers: { location: "https://evil.example/" },
      }),
  );
  await assert.rejects(
    googleResponse(
      await context(),
      "googleDrive",
      [],
      "https://www.googleapis.com/upload/drive/v3/files?upload_id=id",
      {
        method: "PUT",
        body: "bytes",
        headers: { "Content-Range": "bytes 0-4/5" },
      },
    ),
    { code: "transport_failed" },
  );
});
