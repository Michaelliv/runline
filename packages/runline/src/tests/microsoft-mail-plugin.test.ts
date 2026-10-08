import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  CHUNK,
  INLINE_LIMIT,
} from "../../../runline-plugins/microsoftMail/src/attachments.js";
import microsoftMail from "../../../runline-plugins/microsoftMail/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const GRAPH = "https://graph.microsoft.com/v1.0";
const UPLOAD =
  "https://outlook.office.com/api/v2.0/Users('u')/Messages('d1')/AttachmentSessions('s1')?authtoken=x";

type Seen = {
  method: string;
  url: string;
  headers: Headers;
  body?: unknown;
  bytes?: number;
};

function capture(reply: (s: Seen) => Response = () => Response.json({})) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("login.microsoftonline.com"))
      return Response.json({
        access_token: "app",
        token_type: "Bearer",
        expires_in: 3600,
      });
    const headers = new Headers(init?.headers);
    const s: Seen = {
      method: init?.method ?? "GET",
      url: String(url),
      headers,
    };
    if (init?.body instanceof Uint8Array) {
      if (headers.get("content-type") === "application/json")
        s.body = JSON.parse(new TextDecoder().decode(init.body));
      else s.bytes = init.body.length;
    }
    seen.push(s);
    return reply(s);
  }) as typeof fetch;
  return seen;
}

const delegated = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "r",
  accessToken: "t",
  accessTokenExpiresAt: Date.now() + 3_600_000,
};

function run(
  name: string,
  input: Record<string, unknown>,
  config: Record<string, unknown> = delegated,
) {
  const { api, resolve } = createPluginAPI("microsoftMail");
  microsoftMail(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, name);
  const connection = {
    name: "mail",
    plugin: "microsoftMail",
    config: { ...config },
  };
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) Object.assign(connection.config, patch);
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: test reads loose answers
  return Promise.resolve(found.execute(input, ctx)) as Promise<any>;
}

const b64 = (s: string) => Buffer.from(s).toString("base64");
const route = (seen: Seen[]) =>
  seen.map((s) => `${s.method} ${s.url.replace(GRAPH, "")}`);

describe("microsoftMail", () => {
  it("annotates every action with its access", () => {
    const { api, resolve } = createPluginAPI("microsoftMail");
    microsoftMail(api);
    const access = Object.fromEntries(
      resolve().actions.map((a) => [a.name, a.access]),
    );
    assert.deepEqual(access, {
      "mail.send": "write",
      "mail.draft": "write",
      "draft.send": "write",
      "mail.reply": "write",
      "mail.forward": "write",
      "mail.list": "read",
      "mail.get": "read",
      "attachment.add": "write",
      "attachment.list": "read",
      "attachment.get": "read",
      "attachment.delete": "write",
    });
  });

  it("sends without attachments exactly as before", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    const r = await run("mail.send", {
      to: ["a@b.com"],
      subject: "s",
      body: "b",
    });
    assert.deepEqual(route(seen), ["POST /me/sendMail"]);
    assert.deepEqual(seen[0].body, {
      message: {
        subject: "s",
        body: { contentType: "Text", content: "b" },
        toRecipients: [{ emailAddress: { address: "a@b.com" } }],
        ccRecipients: [],
      },
      saveToSentItems: true,
    });
    assert.deepEqual(r, { success: true, attachments: [] });
  });

  it("sends small attachments, text and inline images in one sendMail", async () => {
    const seen = capture(() => new Response(null, { status: 202 }));
    await run("mail.send", {
      to: ["Jane Doe <jane@contoso.com>"],
      subject: "Report",
      body: '<img src="cid:logo">',
      html: true,
      attachments: [
        { name: "report.pdf", contentBase64: b64("%PDF") },
        { name: "data.csv", content: "a,b\n1,2" },
        {
          name: "logo.png",
          contentBase64: { base64: b64("png") },
          inline: true,
          contentId: "logo",
        },
      ],
    });
    assert.deepEqual(route(seen), ["POST /me/sendMail"]);
    const msg = (
      seen[0].body as {
        message: {
          toRecipients: unknown[];
          attachments: Record<string, unknown>[];
        };
      }
    ).message;
    assert.deepEqual(msg.toRecipients, [
      { emailAddress: { address: "jane@contoso.com", name: "Jane Doe" } },
    ]);
    assert.deepEqual(msg.attachments[0], {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "report.pdf",
      contentType: "application/pdf",
      contentBytes: b64("%PDF"),
      isInline: false,
    });
    assert.equal(msg.attachments[1].contentType, "text/csv");
    assert.equal(msg.attachments[1].contentBytes, b64("a,b\n1,2"));
    assert.equal(msg.attachments[2].isInline, true);
    assert.equal(msg.attachments[2].contentId, "logo");
  });

  it("sends large files from a draft through an upload session, without a bearer", async () => {
    const size = 2 * CHUNK + 123;
    const seen = capture((s) => {
      if (s.url === `${GRAPH}/me/messages`)
        return Response.json({ id: "d1" }, { status: 201 });
      if (s.url.endsWith("/createUploadSession"))
        return Response.json({ uploadUrl: UPLOAD }, { status: 201 });
      if (s.url === UPLOAD)
        return s.headers.get("content-range")?.endsWith(`/${size}`) &&
          s.headers.get("content-range")?.includes(`-${size - 1}/`)
          ? new Response(null, {
              status: 201,
              headers: {
                Location:
                  "https://outlook.office.com/api/v2.0/Users('u')/Messages('d1')/Attachments('att-9')",
              },
            })
          : Response.json({ nextExpectedRanges: [] });
      return new Response(null, { status: 202 });
    });
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    const file = join(dir, "big.xlsx");
    await writeFile(file, Buffer.alloc(size, 7));

    const r = await run("mail.send", {
      to: ["a@b.com"],
      subject: "s",
      body: "b",
      attachments: [{ contentPath: file }],
    });
    assert.deepEqual(route(seen), [
      "POST /me/messages",
      "POST /me/messages/d1/attachments/createUploadSession",
      `PUT ${UPLOAD}`,
      `PUT ${UPLOAD}`,
      `PUT ${UPLOAD}`,
      "POST /me/messages/d1/send",
    ]);
    assert.deepEqual(seen[1].body, {
      AttachmentItem: {
        attachmentType: "file",
        name: "big.xlsx",
        size,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        isInline: false,
      },
    });
    const puts = seen.filter((s) => s.method === "PUT");
    assert.deepEqual(
      puts.map((p) => p.headers.get("content-range")),
      [
        `bytes 0-${CHUNK - 1}/${size}`,
        `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`,
        `bytes ${2 * CHUNK}-${size - 1}/${size}`,
      ],
    );
    assert.deepEqual(
      puts.map((p) => p.bytes),
      [CHUNK, CHUNK, 123],
    );
    for (const p of puts) assert.equal(p.headers.get("authorization"), null);
    assert.equal(r.attachments[0].id, "att-9");
    assert.equal(r.attachments[0].method, "uploadSession");
  });

  it("deletes its draft when attaching fails, and never sends", async () => {
    const seen = capture((s) => {
      if (s.url === `${GRAPH}/me/messages`)
        return Response.json({ id: "d1" }, { status: 201 });
      if (s.url.endsWith("/createUploadSession"))
        return new Response(null, { status: 403 });
      return new Response(null, { status: 204 });
    });
    await assert.rejects(
      run("mail.send", {
        to: ["a@b.com"],
        subject: "s",
        body: "b",
        attachments: [
          { contentBase64: Buffer.alloc(INLINE_LIMIT).toString("base64") },
        ],
      }),
      /HTTP 403/,
    );
    assert.deepEqual(route(seen).at(-1), "DELETE /me/messages/d1");
    assert.ok(!seen.some((s) => s.url.endsWith("/send")));
  });

  it("refuses an upload URL outside Outlook's hosts", async () => {
    capture((s) => {
      if (s.url === `${GRAPH}/me/messages`)
        return Response.json({ id: "d1" }, { status: 201 });
      if (s.url.endsWith("/createUploadSession"))
        return Response.json({ uploadUrl: "https://evil.example.com/up" });
      return new Response(null, { status: 204 });
    });
    await assert.rejects(
      run("mail.draft", {
        subject: "s",
        body: "b",
        attachments: [
          { contentBase64: Buffer.alloc(INLINE_LIMIT).toString("base64") },
        ],
      }),
      /unexpected upload URL/,
    );
  });

  it("checks attachment inputs before any request", async () => {
    const seen = capture();
    for (const [attachment, error] of [
      [{ name: "x" }, /exactly one of contentBase64, contentPath or content/],
      [{ content: "x", contentBase64: b64("x") }, /exactly one/],
      [{ content: "x", inline: true }, /needs a contentId/],
      [{ contentPath: "/no/such/file" }, /no file at/],
      [{ contentBase64: "@@@" }, /not valid base64/],
    ] as const)
      await assert.rejects(
        run("mail.send", {
          to: ["a@b.com"],
          subject: "s",
          body: "b",
          attachments: [attachment],
        }),
        error,
      );
    assert.equal(seen.length, 0);
  });

  it("replies with attachments and can keep the reply as a draft", async () => {
    const seen = capture((s) =>
      s.url.endsWith("/createReplyAll")
        ? Response.json({ id: "r1" }, { status: 201 })
        : Response.json({ id: "a1" }, { status: 201 }),
    );
    const r = await run("mail.reply", {
      id: "AAMk+1=",
      replyAll: true,
      comment: "Updated",
      attachments: [{ name: "notes.txt", content: "n" }],
      send: false,
    });
    assert.deepEqual(route(seen), [
      "POST /me/messages/AAMk%2B1%3D/createReplyAll",
      "POST /me/messages/r1/attachments",
    ]);
    assert.deepEqual(seen[0].body, { comment: "Updated" });
    assert.equal(r.id, "r1");
  });

  it("forwards to new recipients and sends", async () => {
    const seen = capture((s) =>
      s.url.endsWith("/createForward")
        ? Response.json({ id: "f1" }, { status: 201 })
        : new Response(null, { status: 202 }),
    );
    const r = await run("mail.forward", { id: "m1", to: ["x@y.com"] });
    assert.deepEqual(route(seen), [
      "POST /me/messages/m1/createForward",
      "POST /me/messages/f1/send",
    ]);
    assert.deepEqual(seen[0].body, {
      toRecipients: [{ emailAddress: { address: "x@y.com" } }],
      comment: "",
    });
    assert.deepEqual(r, { success: true, attachments: [] });
  });

  it("downloads an attachment as base64 or into a directory", async () => {
    capture((s) =>
      s.url.includes("/$value")
        ? new Response(Buffer.from("PDFDATA"))
        : Response.json({
            "@odata.type": "#microsoft.graph.fileAttachment",
            id: "a1",
            name: "inv.pdf",
            contentType: "application/pdf",
            isInline: false,
          }),
    );
    const r = await run("attachment.get", {
      messageId: "m1",
      attachmentId: "a1",
    });
    assert.equal(Buffer.from(r.contentBase64, "base64").toString(), "PDFDATA");

    const dir = await mkdtemp(join(tmpdir(), "mail-dl-"));
    const saved = await run("attachment.get", {
      messageId: "m1",
      attachmentId: "a1",
      savePath: dir,
    });
    assert.equal(saved.path, join(dir, "inv.pdf"));
    assert.equal(saved.contentBase64, undefined);
    assert.equal(await readFile(saved.path, "utf-8"), "PDFDATA");
  });

  it("refuses to download a cloud-link attachment", async () => {
    capture(() =>
      Response.json({
        "@odata.type": "#microsoft.graph.referenceAttachment",
        id: "a1",
        name: "doc",
      }),
    );
    await assert.rejects(
      run("attachment.get", { messageId: "m1", attachmentId: "a1" }),
      /cloud link/,
    );
  });

  it("addresses an app-only mailbox by its UPN", async () => {
    const seen = capture(() => Response.json({ value: [] }));
    await run(
      "attachment.list",
      { messageId: "m1" },
      {
        authMethod: "appOnly",
        tenantId: "contoso.onmicrosoft.com",
        clientId: "client",
        clientSecret: "secret",
        userUpn: "agent@contoso.com",
      },
    );
    assert.deepEqual(route(seen), [
      "GET /users/agent%40contoso.com/messages/m1/attachments?$select=id,name,contentType,size,isInline",
    ]);
    assert.equal(seen[0].headers.get("authorization"), "Bearer app");
  });

  it("refuses an empty or dot message id", async () => {
    const seen = capture();
    for (const id of ["", ".", ".."])
      await assert.rejects(run("draft.send", { id }));
    assert.equal(seen.length, 0);
  });
});
