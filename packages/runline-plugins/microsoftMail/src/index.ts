/**
 * Microsoft Outlook mail plugin for runline (Microsoft Graph).
 *
 * Auth: Microsoft identity platform OAuth2 (delegated, acts as the signed-in
 * user → /me) seeded by the OAuth flow; or app-only client credentials
 * (set tenantId/clientId/clientSecret + userUpn) for an unattended service
 * mailbox. Delegated consent belongs to the "microsoft" grant, so one Entra
 * app and one cached token serve every Microsoft plugin. See
 * _shared/microsoftAuth.ts.
 *
 * Graph delegated scopes: Mail.Send, Mail.ReadWrite, Mail.Read.
 *
 * Attachments follow Graph's two documented paths: a file under 3 MB goes
 * in one request with its message (or one POST to a draft); a file of 3 to
 * 150 MB is attached to a draft through an upload session, its bytes PUT
 * in ranges under 4 MB to the session's pre-authenticated Outlook URL. A
 * message built as a draft is sent once every file is attached, and the
 * draft is deleted if any step fails.
 */
import {
  type ActionContext,
  jsonAnswer,
  pathSegment,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";
import {
  type AttachmentFile,
  type AttachmentInput,
  attachmentFile,
  attachmentSources,
} from "../../_shared/attachments.js";
import {
  graphFailed,
  graphRequest,
  graphResponse,
  microsoftCredential,
  microsoftOAuth,
  outlookUpload,
  userBase,
} from "../../_shared/microsoftAuth.js";

const NAME = "microsoftMail";
const SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Read",
];
type Ctx = ActionContext;

/** Graph attaches a file in one request only under 3 MB. */
const ONE_REQUEST_BYTES = 3 * 1024 * 1024;
/** Graph's ceiling for one file attachment, through an upload session. */
const MAX_ATTACHMENT_BYTES = 150 * 1024 * 1024;
/** Upload session ranges stay under Graph's 4 MB guidance. */
const UPLOAD_RANGE_BYTES = 3 * 1024 * 1024;

const STRICT = { additionalProperties: false } as const;
const Id = (description?: string) =>
  t.String({ minLength: 1, ...(description ? { description } : {}) });
const Addresses = (description: string, minItems = 0) =>
  t.Array(t.String({ minLength: 1 }), {
    description,
    ...(minItems ? { minItems } : {}),
  });

const Attachments = t.Array(
  t.Union([
    ...attachmentSources(
      "Up to 150 MB a file; Exchange limits a whole message to 35 MB unless the tenant raises it.",
    ),
  ]),
  { minItems: 1 },
);

/** What mail.send and mail.draft compose a message from. */
const compose = {
  to: t.Optional(Addresses("Recipient addresses")),
  cc: t.Optional(Addresses("Cc addresses")),
  bcc: t.Optional(Addresses("Bcc addresses")),
  replyTo: t.Optional(Addresses("Reply-To addresses")),
  subject: t.String(),
  body: t.String(),
  html: t.Optional(
    t.Boolean({ description: "body is HTML (default plain text)" }),
  ),
  importance: t.Optional(
    t.Union([t.Literal("low"), t.Literal("normal"), t.Literal("high")]),
  ),
  attachments: t.Optional(Attachments),
};
const send = t.Object(
  { ...compose, to: Addresses("Recipient addresses", 1) },
  STRICT,
);
const draft = t.Object(compose, STRICT);
const byId = t.Object({ id: Id("Message id") }, STRICT);
const SendNow = t.Optional(
  t.Boolean({
    description: "Send at once (default); false keeps the draft and returns it",
  }),
);
const reply = t.Object(
  {
    id: Id("The message to reply to"),
    comment: t.Optional(t.String({ description: "Text of the reply" })),
    replyAll: t.Optional(
      t.Boolean({ description: "Reply to the sender and every recipient" }),
    ),
    attachments: t.Optional(Attachments),
    send: SendNow,
  },
  STRICT,
);
const forward = t.Object(
  {
    id: Id("The message to forward"),
    to: Addresses("Recipient addresses", 1),
    comment: t.Optional(t.String({ description: "Text above the message" })),
    attachments: t.Optional(Attachments),
    send: SendNow,
  },
  STRICT,
);
const list = t.Object(
  {
    search: t.Optional(Id("KQL search across the mailbox")),
    top: t.Optional(t.Integer({ minimum: 1, description: "Default 20" })),
  },
  STRICT,
);
const attachmentAdd = t.Object(
  {
    messageId: Id("A draft message"),
    attachment: t.Union([
      ...attachmentSources(
        "Up to 150 MB; Exchange limits a whole message to 35 MB unless the tenant raises it.",
      ),
    ]),
  },
  STRICT,
);
const attachmentList = t.Object({ messageId: Id() }, STRICT);
const attachmentRef = t.Object(
  { messageId: Id(), attachmentId: Id("From attachment.list") },
  STRICT,
);

const recipients = (addresses: readonly string[] | undefined) =>
  (addresses ?? []).map((address) => ({ emailAddress: { address } }));

function graph<T = unknown>(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return graphRequest<T>(ctx, NAME, SCOPES, method, path, body);
}

const messagePath = (ctx: Ctx, id: string) =>
  `${userBase(ctx)}/messages/${pathSegment(id)}`;

/** Every attachment's bytes, named, before any request. */
function files(inputs: readonly AttachmentInput[] = []) {
  return Promise.all(
    inputs.map(async (input, index) => {
      const file = await attachmentFile(input, index, {
        plugin: NAME,
        maxBytes: MAX_ATTACHMENT_BYTES,
        oversize: `${NAME}: attachment ${index} exceeds Graph's 150 MB attachment limit`,
      });
      return { ...file, name: file.name ?? `attachment-${index + 1}`, input };
    }),
  );
}
/** An attachment's bytes, named, with the input that asked for it. */
type Prepared = AttachmentFile & { name: string; input: AttachmentInput };

/** Whether the files ride in the same request as their message. */
const oneRequest = (all: Prepared[]) =>
  all.reduce((sum, file) => sum + file.bytes.length, 0) < ONE_REQUEST_BYTES;

/** Graph's fileAttachment, for a file sent in one request. */
function fileAttachment(file: Prepared) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: file.name,
    contentBytes: file.bytes.toString("base64"),
    ...(file.mimeType ? { contentType: file.mimeType } : {}),
    ...(file.input.inline !== undefined ? { isInline: file.input.inline } : {}),
    ...(file.input.contentId ? { contentId: file.input.contentId } : {}),
  };
}

/** The attachment id in an upload session's final Location header. */
const LOCATION_ID = /Attachments\('([^']+)'\)/;

/**
 * Attach one file of 3 to 150 MB through an upload session: its ranges
 * PUT in order, each checked against the range the session expects next.
 * A failed upload deletes the session.
 */
async function uploadSession(
  ctx: Ctx,
  messageId: string,
  file: Prepared,
): Promise<string | undefined> {
  const session = await graph<{ uploadUrl?: unknown }>(
    ctx,
    "POST",
    `${messagePath(ctx, messageId)}/attachments/createUploadSession`,
    {
      AttachmentItem: {
        attachmentType: "file",
        name: file.name,
        size: file.bytes.length,
        ...(file.mimeType ? { contentType: file.mimeType } : {}),
        ...(file.input.inline !== undefined
          ? { isInline: file.input.inline }
          : {}),
        ...(file.input.contentId ? { contentId: file.input.contentId } : {}),
      },
    },
  );
  const total = file.bytes.length;
  try {
    for (let start = 0; start < total; start += UPLOAD_RANGE_BYTES) {
      const end = Math.min(start + UPLOAD_RANGE_BYTES, total);
      const res = await outlookUpload(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${start}-${end - 1}/${total}`,
        },
        body: file.bytes.subarray(start, end),
      });
      if (!res.ok) throw await graphFailed(NAME, res);
      if (end === total)
        return LOCATION_ID.exec(res.headers.get("location") ?? "")?.[1];
      const { nextExpectedRanges } = await jsonAnswer<{
        nextExpectedRanges?: string[];
      }>(res);
      const next = nextExpectedRanges?.[0]?.split("-")[0];
      if (next !== undefined && Number(next) !== end)
        throw new Error(
          `${NAME}: the upload session expects byte ${next}, not ${end}`,
        );
    }
  } catch (error) {
    await outlookUpload(session.uploadUrl, { method: "DELETE" }).catch(
      () => undefined,
    );
    throw error;
  }
  return undefined;
}

/** Attach one file to a draft, by the path its size takes. */
async function attach(
  ctx: Ctx,
  messageId: string,
  file: Prepared,
): Promise<{ id?: string; name: string; size: number }> {
  const id =
    file.bytes.length < ONE_REQUEST_BYTES
      ? (
          await graph<{ id?: string }>(
            ctx,
            "POST",
            `${messagePath(ctx, messageId)}/attachments`,
            fileAttachment(file),
          )
        ).id
      : await uploadSession(ctx, messageId, file);
  return { ...(id ? { id } : {}), name: file.name, size: file.bytes.length };
}

/**
 * Finish a draft this call created: attach its files, then send it or
 * hand it back. Any failure deletes the draft, so no half-built message
 * is left in Drafts.
 */
async function finishDraft(
  ctx: Ctx,
  created: { id: string; webLink?: string },
  pending: Prepared[],
  sendIt: boolean,
): Promise<Record<string, unknown>> {
  try {
    for (const file of pending) await attach(ctx, created.id, file);
    if (!sendIt) return { id: created.id, webLink: created.webLink };
    await graph(ctx, "POST", `${messagePath(ctx, created.id)}/send`);
    return { success: true };
  } catch (error) {
    await graph(ctx, "DELETE", messagePath(ctx, created.id)).catch(
      () => undefined,
    );
    throw error;
  }
}

/** A Graph message from compose fields, with the files that ride along. */
function message(p: t.Static<typeof draft>, attached: Prepared[]) {
  return {
    subject: p.subject,
    body: { contentType: p.html ? "HTML" : "Text", content: p.body },
    toRecipients: recipients(p.to),
    ccRecipients: recipients(p.cc),
    ...(p.bcc ? { bccRecipients: recipients(p.bcc) } : {}),
    ...(p.replyTo ? { replyTo: recipients(p.replyTo) } : {}),
    ...(p.importance ? { importance: p.importance } : {}),
    ...(attached.length ? { attachments: attached.map(fileAttachment) } : {}),
  };
}

export default function microsoftMail(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.1.0");
  rl.setCredential(microsoftCredential(NAME, SCOPES));

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "delegated or appOnly; legacy configs infer the method from existing credentials",
    },
    tenantId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_TENANT_ID",
      description: "Entra tenant id (app-only) or omit for OAuth /common",
    },
    clientId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_ID",
      description: "App (client) id",
    },
    clientSecret: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_SECRET",
      description: "Client secret VALUE",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "MICROSOFTMAIL_REFRESH_TOKEN",
      description: "OAuth2 refresh token (set by the login flow)",
    },
    userUpn: {
      type: "string",
      required: false,
      env: "MS_GRAPH_USER_UPN",
      description: "App-only only: target mailbox UPN (e.g. agent@contoso.com)",
    },
  });

  rl.setOAuth(microsoftOAuth(SCOPES, "Mail.Send, Mail.ReadWrite, Mail.Read"));

  rl.registerAction("mail.send", {
    access: "write",
    description:
      "Send an email as the connected mailbox, with attachments. Returns {success}. Get user approval before sending external mail.",
    inputSchema: send,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof send>;
      const all = await files(p.attachments);
      if (oneRequest(all)) {
        await graph(ctx, "POST", `${userBase(ctx)}/sendMail`, {
          message: message(p, all),
          saveToSentItems: true,
        });
        return { success: true };
      }
      const created = await graph<{ id: string }>(
        ctx,
        "POST",
        `${userBase(ctx)}/messages`,
        message(p, []),
      );
      return finishDraft(ctx, created, all, true);
    },
  });

  rl.registerAction("mail.draft", {
    access: "write",
    description:
      "Create a draft email, with attachments (not sent). Returns {id, webLink}; draft.send sends it.",
    inputSchema: draft,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof draft>;
      const all = await files(p.attachments);
      const together = oneRequest(all);
      const created = await graph<{ id: string; webLink?: string }>(
        ctx,
        "POST",
        `${userBase(ctx)}/messages`,
        message(p, together ? all : []),
      );
      return finishDraft(ctx, created, together ? [] : all, false);
    },
  });

  rl.registerAction("draft.send", {
    access: "write",
    description: "Send a draft message. Returns {success}.",
    inputSchema: byId,
    async execute(input, ctx: Ctx) {
      const { id } = input as t.Static<typeof byId>;
      await graph(ctx, "POST", `${messagePath(ctx, id)}/send`);
      return { success: true };
    },
  });

  rl.registerAction("mail.reply", {
    access: "write",
    description:
      "Reply to a message, or with replyAll to everyone on it, with attachments. Returns {success}, or {id, webLink} of the draft when send is false.",
    inputSchema: reply,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof reply>;
      const all = await files(p.attachments);
      const created = await graph<{ id: string; webLink?: string }>(
        ctx,
        "POST",
        `${messagePath(ctx, p.id)}/${p.replyAll ? "createReplyAll" : "createReply"}`,
        p.comment === undefined ? {} : { comment: p.comment },
      );
      return finishDraft(ctx, created, all, p.send ?? true);
    },
  });

  rl.registerAction("mail.forward", {
    access: "write",
    description:
      "Forward a message to more people, with attachments. Returns {success}, or {id, webLink} of the draft when send is false.",
    inputSchema: forward,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof forward>;
      const all = await files(p.attachments);
      const created = await graph<{ id: string; webLink?: string }>(
        ctx,
        "POST",
        `${messagePath(ctx, p.id)}/createForward`,
        {
          toRecipients: recipients(p.to),
          ...(p.comment === undefined ? {} : { comment: p.comment }),
        },
      );
      return finishDraft(ctx, created, all, p.send ?? true);
    },
  });

  rl.registerAction("mail.list", {
    access: "read",
    description:
      "List recent messages, or search with KQL (results come newest first). Returns [{id,subject,from,receivedDateTime,bodyPreview,hasAttachments}].",
    inputSchema: list,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof list>;
      const qs = new URLSearchParams({
        $top: String(p.top ?? 20),
        $select: "id,subject,from,receivedDateTime,bodyPreview,hasAttachments",
      });
      if (p.search) qs.set("$search", `"${p.search}"`);
      else qs.set("$orderby", "receivedDateTime desc");
      const r = await graph<{ value: unknown[] }>(
        ctx,
        "GET",
        `${userBase(ctx)}/messages?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("mail.get", {
    access: "read",
    description:
      "Get one message with full body by id. Its files are listed by attachment.list.",
    inputSchema: byId,
    async execute(input, ctx: Ctx) {
      const { id } = input as t.Static<typeof byId>;
      return graph(ctx, "GET", messagePath(ctx, id));
    },
  });

  rl.registerAction("attachment.add", {
    access: "write",
    description: "Attach a file to a draft message. Returns {id, name, size}.",
    inputSchema: attachmentAdd,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof attachmentAdd>;
      const [file] = await files([p.attachment]);
      return attach(ctx, p.messageId, file);
    },
  });

  rl.registerAction("attachment.list", {
    access: "read",
    description:
      "List a message's attachments. Returns [{id,name,contentType,size,isInline}].",
    inputSchema: attachmentList,
    async execute(input, ctx: Ctx) {
      const { messageId } = input as t.Static<typeof attachmentList>;
      const r = await graph<{ value: unknown[] }>(
        ctx,
        "GET",
        `${messagePath(ctx, messageId)}/attachments?$select=id,name,contentType,size,isInline`,
      );
      return r.value;
    },
  });

  rl.registerAction("attachment.get", {
    access: "read",
    description:
      "Download one file attachment. Returns {name, mimeType, size, contentBase64}, accepted as-is as an attachment by mail plugins. A link (reference) attachment has no bytes and fails with HTTP 405.",
    inputSchema: attachmentRef,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof attachmentRef>;
      const path = `${messagePath(ctx, p.messageId)}/attachments/${pathSegment(p.attachmentId)}`;
      const meta = await graph<{ name?: string; contentType?: string }>(
        ctx,
        "GET",
        `${path}?$select=name,contentType`,
      );
      const res = await graphResponse(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${path}/$value`,
        undefined,
        undefined,
        "*/*",
      );
      if (!res.ok) throw await graphFailed(NAME, res);
      const bytes = Buffer.from(await res.arrayBuffer());
      return {
        ...(meta.name ? { name: meta.name } : {}),
        ...(meta.contentType ? { mimeType: meta.contentType } : {}),
        size: bytes.length,
        contentBase64: bytes.toString("base64"),
      };
    },
  });

  rl.registerAction("attachment.delete", {
    access: "write",
    description:
      "Remove an attachment from a draft message. Returns {success}.",
    inputSchema: attachmentRef,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof attachmentRef>;
      await graph(
        ctx,
        "DELETE",
        `${messagePath(ctx, p.messageId)}/attachments/${pathSegment(p.attachmentId)}`,
      );
      return { success: true };
    },
  });
}
