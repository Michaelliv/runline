import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  atLeastOne,
  attachments,
  clientId,
  contentFields,
  draftFields,
  id,
  idList,
  inboxFields,
  labelFields,
  listFields,
  STRICT,
  sendFields,
  strings,
  timestamp,
} from "./schemas.js";
import {
  attachmentPath,
  draftPath,
  inboxPath,
  request,
  sendMessage,
} from "./shared.js";

const list = t.Object({ ...inboxFields, ...listFields }, STRICT);
const draft = t.Object(draftFields, STRICT);
const attachment = t.Object({ ...draftFields, attachmentId: id }, STRICT);
const create = t.Object(
  {
    ...inboxFields,
    ...contentFields,
    to: t.Optional(strings),
    cc: t.Optional(strings),
    bcc: t.Optional(strings),
    replyTo: t.Optional(strings),
    subject: t.Optional(t.String()),
    labels: t.Optional(strings),
    inReplyTo: t.Optional(id),
    forwardOf: t.Optional(id),
    replyAll: t.Optional(t.Boolean()),
    sendAt: t.Optional(timestamp),
    clientId: t.Optional(clientId),
  },
  {
    ...STRICT,
    allOf: [
      // A draft replies or forwards, never both.
      { not: { required: ["inReplyTo", "forwardOf"] } },
      // replyAll: true derives every recipient from the message it replies to.
      {
        anyOf: [
          {
            not: {
              required: ["replyAll"],
              properties: { replyAll: { const: true } },
            },
          },
          {
            required: ["inReplyTo"],
            not: {
              anyOf: [
                { required: ["to"] },
                { required: ["cc"] },
                { required: ["bcc"] },
              ],
            },
          },
        ],
      },
    ],
  },
);
const nullable = <S extends t.TSchema>(schema: S) =>
  t.Optional(t.Union([schema, t.Null()]));
const changes = {
  ...labelFields,
  to: nullable(strings),
  cc: nullable(strings),
  bcc: nullable(strings),
  replyTo: nullable(strings),
  subject: nullable(t.String()),
  text: nullable(t.String()),
  html: nullable(t.String()),
  sendAt: nullable(timestamp),
  addAttachments: t.Optional(attachments),
  removeAttachments: t.Optional(idList),
};
const update = t.Object(
  { ...draftFields, ...changes },
  { ...STRICT, ...atLeastOne(changes) },
);
const send = t.Object(
  { ...draftFields, ...labelFields, ...sendFields },
  STRICT,
);

export function registerDraftActions(rl: RunlinePluginAPI): void {
  rl.registerAction("draft.list", {
    access: "read",
    description:
      "List one page of inbox drafts, preserving next_page_token. Includes optional label and timestamp filters.",
    inputSchema: list,
    execute: (input, ctx) => {
      const { inboxId, ...query } = input as t.Static<typeof list>;
      return request(ctx, `${inboxPath(inboxId)}/drafts`, { query });
    },
  });
  rl.registerAction("draft.get", {
    access: "read",
    description: "Get a draft for review before sending.",
    inputSchema: draft,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof draft>;
      return request(ctx, draftPath(p.inboxId, p.draftId));
    },
  });
  rl.registerAction("draft.create", {
    access: "write",
    description:
      "Create a draft for review, or schedule automatic delivery with sendAt. Empty drafts are valid. inReplyTo and forwardOf are mutually exclusive; replyAll requires inReplyTo and no recipient overrides. Use clientId for retry-safe creation.",
    inputSchema: create,
    execute: (input, ctx) => {
      const { inboxId, ...body } = input as t.Static<typeof create>;
      return request(ctx, `${inboxPath(inboxId)}/drafts`, {
        method: "POST",
        body,
      });
    },
  });
  rl.registerAction("draft.update", {
    access: "write",
    description:
      "Edit a draft without changing its kind. Omitted fields stay unchanged; null or [] clears recipients. sendAt schedules/reschedules automatic delivery; null cancels scheduling. Attachments use addAttachments/removeAttachments.",
    inputSchema: update,
    execute: (input, ctx) => {
      const { inboxId, draftId, ...body } = input as t.Static<typeof update>;
      return request(ctx, draftPath(inboxId, draftId), {
        method: "PATCH",
        body,
      });
    },
  });
  rl.registerAction("draft.delete", {
    access: "write",
    description: "Delete a draft rather than sending it.",
    inputSchema: draft,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof draft>;
      return request(ctx, draftPath(p.inboxId, p.draftId), {
        method: "DELETE",
      });
    },
  });
  rl.registerAction("draft.send", {
    access: "write",
    description:
      "Send an existing draft now. Returns message_id and thread_id. No automatic retries; supply idempotencyKey for retries of the identical send within 24 hours.",
    inputSchema: send,
    execute: (input, ctx) => {
      const { inboxId, draftId, idempotencyKey, ...body } = input as t.Static<
        typeof send
      >;
      return sendMessage(
        ctx,
        `${draftPath(inboxId, draftId)}/send`,
        body,
        idempotencyKey,
      );
    },
  });
  rl.registerAction("draft.attachment", {
    access: "read",
    description:
      "Get draft attachment metadata and a temporary download_url (plus text_url when text was extracted), without fetching them. Treat the URLs as private.",
    inputSchema: attachment,
    execute: (input, ctx) => {
      const p = input as t.Static<typeof attachment>;
      return request(
        ctx,
        attachmentPath(draftPath(p.inboxId, p.draftId), p.attachmentId),
      );
    },
  });
}
