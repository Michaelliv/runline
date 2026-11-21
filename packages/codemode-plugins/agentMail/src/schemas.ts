import * as t from "typebox";
import {
  attachmentMetadata,
  attachmentSources,
} from "../../_shared/attachments.js";

export const STRICT = { additionalProperties: false } as const;
export const MAX_REQUEST_BYTES = 6_000_000;
export const id = t.String({ minLength: 1, pattern: "\\S" });

export const inboxFields = {
  inboxId: t.String({
    ...id,
    description:
      "Inbox ID (its email address) from inbox.create or inbox.list.",
  }),
};
export const messageFields = { ...inboxFields, messageId: id };
export const threadFields = { ...inboxFields, threadId: id };
export const draftFields = { ...inboxFields, draftId: id };
export const strings = t.Array(id);
export const idList = t.Array(id, { minItems: 1 });
export const timestamp = t.String({
  format: "date-time",
  description: "RFC 3339 timestamp, including timezone.",
});
export const pageFields = {
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 100,
      description: "Maximum items in this page (at most 100).",
    }),
  ),
  pageToken: t.Optional(
    t.String({
      ...id,
      description:
        "Pass next_page_token from the preceding response. No automatic pagination.",
    }),
  ),
};
export const dateFields = {
  before: t.Optional(timestamp),
  after: t.Optional(timestamp),
};
export const listFields = {
  ...pageFields,
  ...dateFields,
  labels: t.Optional(strings),
  ascending: t.Optional(t.Boolean()),
};
export const mailListFields = {
  ...listFields,
  includeSpam: t.Optional(t.Boolean()),
  includeBlocked: t.Optional(t.Boolean()),
  includeUnauthenticated: t.Optional(t.Boolean()),
  includeTrash: t.Optional(t.Boolean()),
  subject: t.Optional(
    t.Array(id, {
      description: "Subject substring filters; all values must match.",
    }),
  ),
};
export const searchFields = {
  ...pageFields,
  ...dateFields,
  query: t.String({
    ...id,
    description:
      "Full-text body search; sender, recipient and subject substring search.",
  }),
};
export const labelFields = {
  addLabels: t.Optional(idList),
  removeLabels: t.Optional(idList),
};
export const clientId = t.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9._~-]+$",
  description:
    "Stable client ID for idempotent resource creation. Reuse for retries of the same resource only.",
});
export const sendFields = {
  idempotencyKey: t.Optional(
    t.String({
      ...clientId,
      description:
        "Stable key per logical send. Reuse with identical input for retries within 24 hours; changed input returns 409. Sent as the Idempotency-Key HTTP header, not email content.",
    }),
  ),
};

/**
 * Attachment bytes come one way each, as every mail plugin takes them,
 * plus AgentMail's own `url`, which AgentMail fetches itself.
 */
export const attachment = t.Union([
  ...attachmentSources(
    "The entire serialized request is limited to 6 MB; use url for larger files.",
  ),
  t.Object(
    {
      ...attachmentMetadata,
      url: t.String({
        pattern: "^https://",
        description:
          "HTTPS URL fetched by AgentMail, not this host. No embedded credentials; keep URL-backed attachments around 30 MB total per message.",
      }),
    },
    STRICT,
  ),
]);
export const attachments = t.Array(attachment, { minItems: 1 });
export const contentFields = {
  text: t.Optional(t.String()),
  html: t.Optional(t.String()),
  attachments: t.Optional(attachments),
};
export const address = t.Union([id, t.Array(id, { minItems: 1 })], {
  description:
    "Email address or addresses; accepts Display Name <user@example.com>.",
});
export const recipientFields = {
  to: t.Optional(address),
  cc: t.Optional(address),
  bcc: t.Optional(address),
};
export const replyContentFields = {
  ...contentFields,
  labels: t.Optional(strings),
  replyTo: t.Optional(address),
  headers: t.Optional(
    t.Record(t.String(), t.String(), {
      description:
        "Email headers, not HTTP headers. Never put API credentials here.",
    }),
  ),
  trackOpens: t.Optional(
    t.Boolean({
      description:
        "Requires an HTML body and a custom domain with tracking enabled.",
    }),
  ),
};
export const messageContentFields = {
  ...replyContentFields,
  ...recipientFields,
  subject: t.Optional(t.String()),
};
