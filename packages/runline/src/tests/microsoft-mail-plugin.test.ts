import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import { DownloadedFile } from "../../../runline-plugins/_shared/base64.js";
import microsoftMail from "../../../runline-plugins/microsoftMail/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const dir = mkdtempSync(join(tmpdir(), "microsoft-mail-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const { api, resolve } = createPluginAPI("microsoftMail");
microsoftMail(api);
const plugin = resolve();

/** A connection whose updates commit, as a store's would. */
function context(config: Record<string, unknown> = {}): ActionContext {
  const connection = {
    name: "mail",
    plugin: "microsoftMail",
    config: {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "r",
      accessToken: "t",
      ...config,
    },
  };
  return {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) connection.config = { ...connection.config, ...patch };
    },
  };
}
async function run(name: string, input: unknown, ctx = context()) {
  return getAction(plugin, name).execute(input, ctx) as Promise<
    Record<string, unknown>
  >;
}
/** The engine's verdict on an input, normalization included. */
function valid(name: string, input: unknown) {
  return validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;
}

type Seen = {
  method: string;
  url: URL;
  headers: Headers;
  body?: unknown;
  bytes?: number;
};
const UPLOAD =
  "https://outlook.office.com/api/v2.0/Users('u')/Messages('d1')/AttachmentSessions('s1')?authtoken=secret";

/**
 * A Graph and Outlook stand-in: drafts are `d1`, upload sessions answer
 * in order, and `reply` overrides any answer by method and path.
 */
function mailbox(reply: (s: Seen) => Response | undefined = () => undefined) {
  const seen: Seen[] = [];
  stubFetch(async (url, init) => {
    const body = init?.body as Uint8Array | string | undefined;
    const isJson = new Headers(init?.headers)
      .get("content-type")
      ?.includes("json");
    const s: Seen = {
      method: init?.method ?? "GET",
      url: new URL(String(url)),
      headers: new Headers(init?.headers),
      ...(body && isJson ? { body: JSON.parse(String(body)) } : {}),
      ...(body && !isJson ? { bytes: (body as Uint8Array).byteLength } : {}),
    };
    seen.push(s);
    const custom = reply(s);
    if (custom) return custom;
    const path = s.url.pathname;
    if (s.url.origin === "https://outlook.office.com") {
      const [, end, total] = /bytes \d+-(\d+)\/(\d+)/.exec(
        s.headers.get("content-range") ?? "",
      ) ?? ["", "0", "0"];
      return Number(end) + 1 === Number(total)
        ? new Response(null, {
            status: 201,
            headers: {
              location:
                "https://outlook.office.com/api/v2.0/Users('u')/Messages('d1')/Attachments('big1')",
            },
          })
        : Response.json({ nextExpectedRanges: [`${Number(end) + 1}`] });
    }
    if (path.endsWith("/createUploadSession"))
      return Response.json({ uploadUrl: UPLOAD }, { status: 201 });
    if (path.endsWith("/attachments") && s.method === "POST")
      return Response.json({ id: "small1" }, { status: 201 });
    if (/\/(messages|createReply|createReplyAll|createForward)$/.test(path))
      return Response.json({ id: "d1", webLink: "w" }, { status: 201 });
    if (s.method === "DELETE" || /\/(send|sendMail)$/.test(path))
      return new Response(null, { status: s.method === "DELETE" ? 204 : 202 });
    return Response.json({});
  });
  return seen;
}
const route = (s: Seen) =>
  `${s.method} ${s.url.origin === "https://outlook.office.com" ? "upload" : s.url.pathname.replace(/^\/v1\.0/, "")}`;

const small = (text: string) => ({
  contentBase64: Buffer.from(text).toString("base64"),
  name: `${text}.txt`,
});
/** A file just over 7 MB: an upload session in three ranges. */
const bigPath = join(dir, "big.bin");
writeFileSync(bigPath, Buffer.alloc(7 * 1024 * 1024 + 5, 1));

describe("microsoftMail actions", () => {
  it("labels every action's access", () => {
    assert.deepEqual(
      Object.fromEntries(plugin.actions.map((a) => [a.name, a.access])),
      {
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
      },
    );
  });
});

describe("microsoftMail send and draft", () => {
  it("sends a message without attachments in one sendMail", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("mail.send", {
        to: ["a@example.com"],
        subject: "Hi",
        body: "Hello",
      }),
      { success: true },
    );
    assert.deepEqual(seen.map(route), ["POST /me/sendMail"]);
    assert.deepEqual(seen[0].body, {
      message: {
        subject: "Hi",
        body: { contentType: "Text", content: "Hello" },
        toRecipients: [{ emailAddress: { address: "a@example.com" } }],
        ccRecipients: [],
      },
      saveToSentItems: true,
    });
  });

  it("sends files under 3 MB in the same sendMail", async () => {
    const seen = mailbox();
    const drive = {
      contentBase64: Buffer.from("PDF").toString("base64"),
      name: "report.pdf",
      mimeType: "application/pdf",
    };
    await run("mail.send", {
      to: ["a@example.com"],
      bcc: ["b@example.com"],
      subject: "Report",
      body: '<img src="cid:logo">',
      html: true,
      importance: "high",
      attachments: [
        { contentBase64: drive },
        { content: "x", name: "logo.png", inline: true, contentId: "logo" },
      ],
    });
    assert.deepEqual(seen.map(route), ["POST /me/sendMail"]);
    const sent = (seen[0].body as { message: Record<string, unknown> }).message;
    assert.equal(sent.importance, "high");
    assert.deepEqual(sent.bccRecipients, [
      { emailAddress: { address: "b@example.com" } },
    ]);
    assert.deepEqual(sent.attachments, [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "report.pdf",
        contentBytes: Buffer.from("PDF").toString("base64"),
        contentType: "application/pdf",
      },
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "logo.png",
        contentBytes: Buffer.from("x").toString("base64"),
        contentType: "text/plain",
        isInline: true,
        contentId: "logo",
      },
    ]);
  });

  it("builds a draft, attaches each file by its size, and sends it", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("mail.send", {
        to: ["a@example.com"],
        subject: "Big",
        body: "See attached",
        attachments: [small("notes"), { contentPath: bigPath }],
      }),
      { success: true },
    );
    assert.deepEqual(seen.map(route), [
      "POST /me/messages",
      "POST /me/messages/d1/attachments",
      "POST /me/messages/d1/attachments/createUploadSession",
      "PUT upload",
      "PUT upload",
      "PUT upload",
      "POST /me/messages/d1/send",
    ]);
    assert.equal(
      (seen[0].body as { attachments?: unknown }).attachments,
      undefined,
    );
    assert.deepEqual(seen[2].body, {
      AttachmentItem: {
        attachmentType: "file",
        name: "big.bin",
        size: 7 * 1024 * 1024 + 5,
      },
    });
    const total = 7 * 1024 * 1024 + 5;
    assert.deepEqual(
      seen.slice(3, 6).map((s) => s.headers.get("content-range")),
      [
        `bytes 0-3145727/${total}`,
        `bytes 3145728-6291455/${total}`,
        `bytes 6291456-${total - 1}/${total}`,
      ],
    );
    for (const s of seen.slice(3, 6)) {
      assert.equal(s.headers.has("authorization"), false);
      assert.equal(s.headers.get("content-type"), "application/octet-stream");
    }
  });

  it("keeps a draft with large files when only drafting", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("mail.draft", {
        subject: "Draft",
        body: "Later",
        attachments: [{ contentPath: bigPath }],
      }),
      { id: "d1", webLink: "w" },
    );
    assert.equal(seen.at(-1)?.method, "PUT");
    await run("draft.send", { id: "d1" });
    assert.equal(route(seen.at(-1) as Seen), "POST /me/messages/d1/send");
  });

  it("deletes the draft and the session when an upload fails", async () => {
    const seen = mailbox((s) =>
      s.method === "PUT" &&
      s.headers.get("content-range")?.startsWith("bytes 3")
        ? Response.json(
            { error: { code: "ErrorQuotaExceeded" } },
            { status: 507 },
          )
        : undefined,
    );
    await assert.rejects(
      run("mail.send", {
        to: ["a@example.com"],
        subject: "Big",
        body: "x",
        attachments: [{ contentPath: bigPath }],
      }),
      {
        message: "microsoftMail: request failed (HTTP 507 ErrorQuotaExceeded)",
      },
    );
    assert.deepEqual(seen.slice(-2).map(route), [
      "DELETE upload",
      "DELETE /me/messages/d1",
    ]);
  });

  it("refuses an upload URL off Outlook's origin, deleting the draft", async () => {
    const seen = mailbox((s) =>
      s.url.pathname.endsWith("/createUploadSession")
        ? Response.json(
            { uploadUrl: "https://evil.example/upload" },
            { status: 201 },
          )
        : undefined,
    );
    await assert.rejects(
      run("mail.send", {
        to: ["a@example.com"],
        subject: "Big",
        body: "x",
        attachments: [{ contentPath: bigPath }],
      }),
      { code: "request_not_allowed" },
    );
    assert.ok(seen.every((s) => s.url.hostname !== "evil.example"));
    assert.equal(route(seen.at(-1) as Seen), "DELETE /me/messages/d1");
  });

  it("stops when the session expects another range", async () => {
    mailbox((s) =>
      s.method === "PUT"
        ? Response.json({ nextExpectedRanges: ["0-"] })
        : undefined,
    );
    await assert.rejects(
      run("mail.draft", {
        subject: "x",
        body: "x",
        attachments: [{ contentPath: bigPath }],
      }),
      /the upload session expects byte 0, not 3145728/,
    );
  });
});

describe("microsoftMail reply and forward", () => {
  it("replies, or replies to all, sending the draft once files are on it", async () => {
    const seen = mailbox();
    await run("mail.reply", {
      id: "m1",
      comment: "Thanks",
      attachments: [small("a")],
    });
    await run("mail.reply", { id: "m1", replyAll: true });
    assert.deepEqual(seen.map(route), [
      "POST /me/messages/m1/createReply",
      "POST /me/messages/d1/attachments",
      "POST /me/messages/d1/send",
      "POST /me/messages/m1/createReplyAll",
      "POST /me/messages/d1/send",
    ]);
    assert.deepEqual(seen[0].body, { comment: "Thanks" });
  });

  it("forwards to the given recipients, or keeps the draft", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("mail.forward", {
        id: "m1",
        to: ["c@example.com"],
        comment: "FYI",
        send: false,
      }),
      { id: "d1", webLink: "w" },
    );
    assert.deepEqual(seen.map(route), ["POST /me/messages/m1/createForward"]);
    assert.deepEqual(seen[0].body, {
      toRecipients: [{ emailAddress: { address: "c@example.com" } }],
      comment: "FYI",
    });
    assert.equal(valid("mail.forward", { id: "m1", to: [] }), false);
  });
});

describe("microsoftMail attachments", () => {
  it("adds a file to a draft by its size", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("attachment.add", { messageId: "d1", attachment: small("a") }),
      { id: "small1", name: "a.txt", size: 1 },
    );
    assert.deepEqual(
      await run("attachment.add", {
        messageId: "d1",
        attachment: { contentPath: bigPath },
      }),
      { id: "big1", name: "big.bin", size: 7 * 1024 * 1024 + 5 },
    );
    assert.equal(seen.filter((s) => s.method === "PUT").length, 3);
  });

  it("lists attachment metadata without their bytes", async () => {
    const seen = mailbox(() => Response.json({ value: [{ id: "a1" }] }));
    assert.deepEqual(await run("attachment.list", { messageId: "m1" }), [
      { id: "a1" },
    ]);
    assert.equal(
      seen[0].url.searchParams.get("$select"),
      "id,name,contentType,size,isInline",
    );
  });

  it("downloads a file as a result mail plugins accept as an attachment", async () => {
    const seen = mailbox((s) =>
      s.url.pathname.endsWith("/$value")
        ? new Response("PDF")
        : Response.json({ name: "r.pdf", contentType: "application/pdf" }),
    );
    const result = await run("attachment.get", {
      messageId: "m1",
      attachmentId: "a1",
    });
    assert.deepEqual(result, {
      name: "r.pdf",
      mimeType: "application/pdf",
      size: 3,
      contentBase64: Buffer.from("PDF").toString("base64"),
    });
    assert.ok(Check(DownloadedFile, result));
    assert.deepEqual(seen.map(route), [
      "GET /me/messages/m1/attachments/a1",
      "GET /me/messages/m1/attachments/a1/$value",
    ]);
    assert.equal(seen[1].headers.get("accept"), "*/*");
  });

  it("deletes an attachment from a draft", async () => {
    const seen = mailbox();
    assert.deepEqual(
      await run("attachment.delete", { messageId: "d1", attachmentId: "a1" }),
      { success: true },
    );
    assert.equal(route(seen[0]), "DELETE /me/messages/d1/attachments/a1");
  });

  it("refuses bad attachment input before any request", async () => {
    const seen = mailbox();
    const base = { to: ["a@example.com"], subject: "x", body: "x" };
    await assert.rejects(
      run("mail.send", { ...base, attachments: [{ contentBase64: "%%%" }] }),
      /attachment 0 contentBase64 is not valid base64/,
    );
    await assert.rejects(
      run("mail.send", {
        ...base,
        attachments: [{ contentPath: join(dir, "missing") }],
      }),
      /attachment 0 contentPath is unreadable/,
    );
    assert.equal(seen.length, 0);
    assert.equal(
      valid("mail.send", {
        ...base,
        attachments: [{ contentPath: "a", content: "b" }],
      }),
      false,
    );
  });
});

describe("microsoftMail reading", () => {
  it("orders the list newest first, and leaves a search to its own order", async () => {
    const seen = mailbox(() => Response.json({ value: [] }));
    await run("mail.list", {});
    await run("mail.list", { search: "invoice" });
    assert.equal(
      seen[0].url.searchParams.get("$orderby"),
      "receivedDateTime desc",
    );
    assert.equal(seen[1].url.searchParams.get("$orderby"), null);
    assert.equal(seen[1].url.searchParams.get("$search"), '"invoice"');
  });

  it("acts on the configured mailbox of an app-only connection", async () => {
    const seen = mailbox((s) =>
      s.url.hostname === "login.microsoftonline.com"
        ? Response.json({ access_token: "app" })
        : undefined,
    );
    await run(
      "draft.send",
      { id: "d1" },
      context({
        authMethod: "appOnly",
        tenantId: "tenant",
        userUpn: "agent@example.com",
        accessToken: undefined,
      }),
    );
    assert.equal(
      route(seen.at(-1) as Seen),
      "POST /users/agent%40example.com/messages/d1/send",
    );
  });
});
