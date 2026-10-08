/**
 * Microsoft Outlook mail plugin for runline (Microsoft Graph).
 *
 * Auth: Microsoft identity platform OAuth2 (delegated, acts as the signed-in
 * user → /me) seeded by the OAuth flow; or app-only client credentials
 * (set tenantId/clientId/clientSecret + userUpn) for an unattended service
 * mailbox. Shared "microsoft" OAuth client family (authUrl on
 * login.microsoftonline.com), so one Entra app is reused across the Microsoft
 * plugins. See _shared/microsoftAuth.ts.
 *
 * Attachments: mail.send, mail.draft, mail.reply and mail.forward take
 * `attachments` (see ./attachments.ts for the input shape). Graph takes a
 * file in one POST below 3 MB; 3–150 MB goes through an upload session on a
 * draft. A message whose attachments total 3 MB or more is therefore built
 * as a draft, attached to, then sent; the draft is deleted if a step fails.
 *
 * Graph delegated scopes: Mail.Send, Mail.ReadWrite, Mail.Read.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ActionContext, RunlinePluginAPI } from "runline";
import { requestFailed } from "../../_shared/credentials.js";
import {
  graphRequest,
  graphResponse,
  microsoftCredential,
  microsoftSetupHelp,
  userBase,
} from "../../_shared/microsoftAuth.js";
import {
  type AddedAttachment,
  type Attachment,
  type AttachmentInput,
  addAttachment,
  fileAttachment,
  fitsInline,
  idSegment,
  type MailGraph,
  normalizeAll,
} from "./attachments.js";

const NAME = "microsoftMail";
const SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Read",
];

type Ctx = ActionContext;

/** The fields mail.send and mail.draft compose a Graph message from. */
interface MessageInput {
  to?: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  replyTo?: string[] | string;
  subject: string;
  body?: string;
  html?: boolean;
  importance?: "low" | "normal" | "high";
  attachments?: AttachmentInput[];
}

/** Addresses, each optionally written `Name <address>`. */
const recipients = (addrs: string[] | string | undefined) =>
  (Array.isArray(addrs) ? addrs : addrs ? [addrs] : []).map((raw) => {
    const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(raw);
    const name = m?.[1]?.replace(/^"|"$/g, "");
    return {
      emailAddress: m
        ? { address: m[2], ...(name ? { name } : {}) }
        : { address: raw.trim() },
    };
  });

function toMessage(input: MessageInput, inlineAtts: Attachment[] = []) {
  return {
    subject: input.subject,
    body: {
      contentType: input.html ? "HTML" : "Text",
      content: input.body ?? "",
    },
    toRecipients: recipients(input.to),
    ccRecipients: recipients(input.cc),
    ...(input.bcc ? { bccRecipients: recipients(input.bcc) } : {}),
    ...(input.replyTo ? { replyTo: recipients(input.replyTo) } : {}),
    ...(input.importance ? { importance: input.importance } : {}),
    ...(inlineAtts.length
      ? { attachments: inlineAtts.map(fileAttachment) }
      : {}),
  };
}

function summarize(atts: Attachment[]): AddedAttachment[] {
  return atts.map((a) => ({
    name: a.name,
    size: a.bytes.length,
    contentType: a.contentType,
    isInline: a.isInline,
    method: "inline",
  }));
}

const messagePath = (ctx: Ctx, id: string) =>
  `${userBase(ctx)}/messages/${idSegment(id)}`;

/**
 * Attach to a draft this action created and optionally send it. On any
 * failure the draft is deleted, so no half-built message is left behind.
 */
async function finishDraft(
  ctx: Ctx,
  draftId: string,
  atts: Attachment[],
  send: boolean,
): Promise<AddedAttachment[]> {
  const graph: MailGraph = { ctx, plugin: NAME, scopes: SCOPES };
  try {
    const added: AddedAttachment[] = [];
    for (const a of atts) added.push(await addAttachment(graph, draftId, a));
    if (send)
      await graphRequest(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${messagePath(ctx, draftId)}/send`,
      );
    return added;
  } catch (err) {
    await graphResponse(
      ctx,
      NAME,
      SCOPES,
      "DELETE",
      messagePath(ctx, draftId),
    ).catch(() => undefined);
    throw err;
  }
}

const attachmentsField = {
  type: "array" as const,
  required: false,
  description:
    "Files to attach, up to 150 MB each: [{name?, contentType?, contentPath | contentBase64 | content, inline?, contentId?}]. contentPath is a file on the runline host; contentBase64 also takes a download result carrying contentBase64/base64; content is UTF-8 text. inline + contentId embed an image in an HTML body (cid:<contentId>).",
};

const composeFields = {
  cc: { type: "array" as const, required: false },
  bcc: { type: "array" as const, required: false },
  replyTo: { type: "array" as const, required: false },
  html: {
    type: "boolean" as const,
    required: false,
    description: "Body is HTML (default plain text)",
  },
  importance: {
    type: "string" as const,
    required: false,
    description: "low, normal or high",
  },
  attachments: attachmentsField,
};

export default function microsoftMail(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.0.0");
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

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    setupHelp: microsoftSetupHelp("Mail.Send, Mail.ReadWrite, Mail.Read"),
  });

  rl.registerAction("mail.send", {
    access: "write",
    description:
      "Send an email as the connected mailbox, optionally with attachments. Returns {success, attachments}. Get user approval before sending external mail.",
    inputSchema: {
      to: {
        type: "array",
        required: true,
        description: 'Recipient address(es); "Name <address>" sets a display name',
      },
      subject: { type: "string", required: true },
      body: { type: "string", required: true },
      ...composeFields,
      saveToSentItems: {
        type: "boolean",
        required: false,
        description:
          "Default true. A message with 3 MB or more of attachments is sent from a draft and always saved",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as MessageInput & { saveToSentItems?: boolean };
      const atts = await normalizeAll(p.attachments, NAME);
      if (fitsInline(atts)) {
        await graphRequest(
          ctx,
          NAME,
          SCOPES,
          "POST",
          `${userBase(ctx)}/sendMail`,
          {
            message: toMessage(p, atts),
            saveToSentItems: p.saveToSentItems ?? true,
          },
        );
        return { success: true, attachments: summarize(atts) };
      }
      const draft = await graphRequest<{ id: string }>(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${userBase(ctx)}/messages`,
        toMessage(p),
      );
      const attachments = await finishDraft(ctx, draft.id, atts, true);
      return { success: true, attachments };
    },
  });

  rl.registerAction("mail.draft", {
    access: "write",
    description:
      "Create a draft email (not sent), optionally with attachments. Returns {id, webLink, attachments}. Send it with draft.send.",
    inputSchema: {
      to: { type: "array", required: false },
      subject: { type: "string", required: true },
      body: { type: "string", required: true },
      ...composeFields,
    },
    async execute(input, ctx: Ctx) {
      const p = input as MessageInput;
      const atts = await normalizeAll(p.attachments, NAME);
      const inline = fitsInline(atts);
      const r = await graphRequest<{ id: string; webLink: string }>(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${userBase(ctx)}/messages`,
        toMessage(p, inline ? atts : []),
      );
      const attachments = inline
        ? summarize(atts)
        : await finishDraft(ctx, r.id, atts, false);
      return { id: r.id, webLink: r.webLink, attachments };
    },
  });

  rl.registerAction("draft.send", {
    access: "write",
    description:
      "Send an existing draft by id. Returns {success}. Get user approval before sending external mail.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx: Ctx) {
      const { id } = input as { id: string };
      await graphRequest(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${messagePath(ctx, id)}/send`,
      );
      return { success: true };
    },
  });

  rl.registerAction("mail.reply", {
    access: "write",
    description:
      "Reply (or reply-all) in the message's thread, optionally with attachments. send:false leaves the reply as a draft and returns its id. Returns {success, id?, attachments}.",
    inputSchema: {
      id: { type: "string", required: true, description: "Message to reply to" },
      comment: {
        type: "string",
        required: false,
        description: "Reply text, placed above the quoted thread",
      },
      replyAll: { type: "boolean", required: false },
      attachments: attachmentsField,
      send: { type: "boolean", required: false, description: "Default true" },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        id: string;
        comment?: string;
        replyAll?: boolean;
        attachments?: AttachmentInput[];
        send?: boolean;
      };
      const atts = await normalizeAll(p.attachments, NAME);
      const draft = await graphRequest<{ id: string }>(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${messagePath(ctx, p.id)}/${p.replyAll ? "createReplyAll" : "createReply"}`,
        { comment: p.comment ?? "" },
      );
      const send = p.send ?? true;
      const attachments = await finishDraft(ctx, draft.id, atts, send);
      return { success: true, ...(send ? {} : { id: draft.id }), attachments };
    },
  });

  rl.registerAction("mail.forward", {
    access: "write",
    description:
      "Forward a message (its attachments included) to new recipients, optionally adding attachments. send:false leaves it as a draft and returns its id. Returns {success, id?, attachments}.",
    inputSchema: {
      id: { type: "string", required: true, description: "Message to forward" },
      to: { type: "array", required: true },
      comment: { type: "string", required: false },
      attachments: attachmentsField,
      send: { type: "boolean", required: false, description: "Default true" },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        id: string;
        to: string[] | string;
        comment?: string;
        attachments?: AttachmentInput[];
        send?: boolean;
      };
      const atts = await normalizeAll(p.attachments, NAME);
      const draft = await graphRequest<{ id: string }>(
        ctx,
        NAME,
        SCOPES,
        "POST",
        `${messagePath(ctx, p.id)}/createForward`,
        { toRecipients: recipients(p.to), comment: p.comment ?? "" },
      );
      const send = p.send ?? true;
      const attachments = await finishDraft(ctx, draft.id, atts, send);
      return { success: true, ...(send ? {} : { id: draft.id }), attachments };
    },
  });

  rl.registerAction("mail.list", {
    access: "read",
    description:
      "List recent messages. Optional KQL search. Returns [{id,subject,from,receivedDateTime,bodyPreview,hasAttachments}].",
    inputSchema: {
      search: {
        type: "string",
        required: false,
        description: "KQL search across the mailbox",
      },
      top: { type: "number", required: false, default: 20 },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { search?: string; top?: number };
      const qs = new URLSearchParams({
        $top: String(p.top ?? 20),
        $select: "id,subject,from,receivedDateTime,bodyPreview,hasAttachments",
        $orderby: "receivedDateTime desc",
      });
      if (p.search) qs.set("$search", `"${p.search}"`);
      const r = await graphRequest<{ value: unknown[] }>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${userBase(ctx)}/messages?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("mail.get", {
    access: "read",
    description:
      "Get one message with full body by id. includeAttachments adds attachment metadata (no bytes; use attachment.get).",
    inputSchema: {
      id: { type: "string", required: true },
      includeAttachments: { type: "boolean", required: false },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string; includeAttachments?: boolean };
      const qs = p.includeAttachments
        ? `?$expand=${encodeURIComponent("attachments($select=id,name,contentType,size,isInline)")}`
        : "";
      return graphRequest(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${messagePath(ctx, p.id)}${qs}`,
      );
    },
  });

  rl.registerAction("attachment.add", {
    access: "write",
    description:
      "Add attachments to a draft (Graph allows this on drafts only). Returns [{id,name,size,contentType,isInline,method}].",
    inputSchema: {
      messageId: { type: "string", required: true, description: "Draft id" },
      attachments: { ...attachmentsField, required: true },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { messageId: string; attachments: AttachmentInput[] };
      const atts = await normalizeAll(p.attachments, NAME);
      if (!atts.length) throw new Error(`${NAME}: attachments is empty`);
      const graph: MailGraph = { ctx, plugin: NAME, scopes: SCOPES };
      const added: AddedAttachment[] = [];
      for (const a of atts)
        added.push(await addAttachment(graph, p.messageId, a));
      return added;
    },
  });

  rl.registerAction("attachment.list", {
    access: "read",
    description:
      "List a message's attachments. Returns [{id,name,contentType,size,isInline,'@odata.type'}].",
    inputSchema: { messageId: { type: "string", required: true } },
    async execute(input, ctx: Ctx) {
      const { messageId } = input as { messageId: string };
      const r = await graphRequest<{ value: unknown[] }>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${messagePath(ctx, messageId)}/attachments?$select=id,name,contentType,size,isInline`,
      );
      return r.value;
    },
  });

  rl.registerAction("attachment.get", {
    access: "read",
    description:
      "Download an attachment. Returns {id,name,contentType,size,isInline,contentBase64}; with savePath (a file, or an existing directory) on the runline host it writes the file and returns {…, path} instead of the bytes. An attached email downloads as .eml MIME.",
    inputSchema: {
      messageId: { type: "string", required: true },
      attachmentId: { type: "string", required: true },
      savePath: { type: "string", required: false },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        messageId: string;
        attachmentId: string;
        savePath?: string;
      };
      const path = `${messagePath(ctx, p.messageId)}/attachments/${idSegment(p.attachmentId)}`;
      const meta = await graphRequest<{
        id: string;
        name?: string;
        contentType?: string;
        isInline?: boolean;
        "@odata.type"?: string;
      }>(
        ctx,
        NAME,
        SCOPES,
        "GET",
        `${path}?$select=id,name,contentType,size,isInline`,
      );
      if (meta["@odata.type"] === "#microsoft.graph.referenceAttachment")
        throw new Error(
          `${NAME}: attachment is a cloud link (referenceAttachment) with no bytes to download`,
        );
      const res = await graphResponse(ctx, NAME, SCOPES, "GET", `${path}/$value`);
      if (!res.ok) throw requestFailed(NAME, res.status);
      const bytes = Buffer.from(await res.arrayBuffer());
      const info = {
        id: meta.id,
        name: meta.name,
        contentType: meta.contentType,
        size: bytes.length,
        isInline: meta.isInline ?? false,
      };
      if (!p.savePath)
        return { ...info, contentBase64: bytes.toString("base64") };

      const isDir = await stat(p.savePath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      const isItem = meta["@odata.type"] === "#microsoft.graph.itemAttachment";
      const fileName =
        basename(meta.name || p.attachmentId).replace(/[\\/:*?"<>|]/g, "_") +
        (isItem && !/\.eml$/i.test(meta.name ?? "") ? ".eml" : "");
      const target = isDir ? join(p.savePath, fileName) : p.savePath;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return { ...info, path: target };
    },
  });

  rl.registerAction("attachment.delete", {
    access: "write",
    description: "Remove an attachment from a draft. Returns {success}.",
    inputSchema: {
      messageId: { type: "string", required: true },
      attachmentId: { type: "string", required: true },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { messageId: string; attachmentId: string };
      await graphRequest(
        ctx,
        NAME,
        SCOPES,
        "DELETE",
        `${messagePath(ctx, p.messageId)}/attachments/${idSegment(p.attachmentId)}`,
      );
      return { success: true };
    },
  });
}
