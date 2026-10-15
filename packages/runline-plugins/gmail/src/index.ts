/**
 * Gmail plugin for runline.
 *
 * Authentication: the Google grant's OAuth2 user flow, seeded once
 * via `runline auth gmail`, or a service account. The connection
 * stores `clientId`, `clientSecret` and `refreshToken`; the access
 * token is refreshed lazily (60 s skew) and cached on the connection
 * as the grant's, so every Google plugin sharing it signs with it.
 *
 * This plugin deliberately doesn't depend on nodemailer or
 * mailparser. MIME building is a minimal hand-rolled encoder
 * sufficient for Gmail's `users.messages.send` (`raw` field): a
 * `multipart/mixed` root when attachments are present, with
 * `multipart/alternative` for text+html bodies, or a flat
 * `text/plain` / `text/html` body otherwise. Parsing incoming
 * `raw` messages is left to the caller — actions return the
 * raw Gmail API response (including base64url `raw` for format=raw,
 * or parsed `payload` tree for format=full).
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { DownloadedFile, standardBase64 } from "../../_shared/base64.js";
import { renderEmailJsx } from "../../_shared/emailJsx.js";
import { pathSegment } from "../../_shared/credentials.js";
import {
  googleCredential,
  googleJsonRequest,
  googleOAuth,
} from "../../_shared/googleAuth.js";
import {
  GoogleTimestamp,
  Id,
  NonEmptyString,
  stringEnum,
} from "../../_shared/googleSchemas.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GmailConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

interface EmailAttachmentInput {
  name?: string;
  filename?: string;
  mimeType?: string;
  /** Base64-encoded file contents, or a download result carrying them. */
  contentBase64:
    | string
    | { contentBase64?: unknown; name?: unknown; mimeType?: unknown };
}

interface NormalizedAttachment {
  name: string;
  mimeType: string;
  contentBase64: string;
}

interface EmailInput {
  to: string;
  from?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachmentInput[];
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function sendFailureRetryHint(method: string, path: string): string {
  if (method !== "POST" || !path.endsWith("/send")) return "";
  return " Before retrying, check whether the email was already sent using gmail.message.list({ q: 'in:sent to:<recipient> subject:\"<subject>\"', maxResults: 10 }) and inspect likely matches with gmail.message.get({ id, format: 'metadata' }).";
}

async function gmailRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await googleJsonRequest(ctx, "gmail", SCOPES, method, `${API_BASE}${path}`, body, qs);
  } catch (error) {
    const hint = sendFailureRetryHint(method, path);
    if (!hint) throw error;
    throw new Error(`${error instanceof Error ? error.message : "gmail: request failed"}.${hint}`);
  }
}

async function paginateAll(
  ctx: Ctx,
  path: string,
  key: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = { ...qs, maxResults: 100 };
  do {
    const page = (await gmailRequest(ctx, "GET", path, undefined, query)) as {
      [k: string]: unknown;
      nextPageToken?: string;
    };
    const items = (page[key] as Record<string, unknown>[]) ?? [];
    out.push(...items);
    query.pageToken = page.nextPageToken;
  } while (query.pageToken);
  return out;
}

// ─── MIME encoding ───────────────────────────────────────────────

const CRLF = "\r\n";
const GMAIL_MAX_RAW_BYTES = 35 * 1024 * 1024;

function base64url(bytes: string | Uint8Array): string {
  const buf =
    typeof bytes === "string" ? Buffer.from(bytes, "utf-8") : Buffer.from(bytes);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBoundary(): string {
  return `----=_runline_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function needsEncoding(s: string): boolean {
  // Anything outside printable ASCII gets MIME-encoded-word treatment.
  // Covers non-ASCII subjects/names and a handful of structural chars.
  // eslint-disable-next-line no-control-regex
  return /[^\x20-\x7e]/.test(s);
}

function encodeHeaderWord(s: string): string {
  if (!needsEncoding(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
}

function header(name: string, value: string | undefined): string {
  if (!value) return "";
  return `${name}: ${value}${CRLF}`;
}

function foldedBase64ByteLength(length: number): number {
  return length === 0 ? 0 : length + Math.floor((length - 1) / 76) * CRLF.length;
}

function foldBase64(encoded: string): string {
  let folded = "";
  for (let i = 0; i < encoded.length; i += 76) {
    if (i > 0) folded += CRLF;
    folded += encoded.slice(i, i + 76);
  }
  return folded;
}

function assertAttachmentPayloadFits(atts: NormalizedAttachment[]): void {
  const attachmentBodyBytes = atts.reduce(
    (sum, att) => sum + foldedBase64ByteLength(att.contentBase64.length),
    0,
  );
  if (attachmentBodyBytes > GMAIL_MAX_RAW_BYTES) {
    throw new Error(
      `gmail: attachment payload is ${attachmentBodyBytes} bytes after MIME folding; Gmail API raw messages must be <= ${GMAIL_MAX_RAW_BYTES} bytes`,
    );
  }
}

function textPart(body: string, mimeType: "text/plain" | "text/html"): string {
  const encoded = Buffer.from(body, "utf-8").toString("base64");
  return (
    `Content-Type: ${mimeType}; charset="UTF-8"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${foldBase64(encoded)}${CRLF}`
  );
}

function normalizeAttachment(
  input: EmailAttachmentInput,
  index: number,
): NormalizedAttachment {
  if (!input || typeof input !== "object") {
    throw new Error(`gmail: attachment ${index} must be an object`);
  }

  const content = input.contentBase64;
  const contentBase64 =
    typeof content === "string"
      ? content
      : content &&
          typeof content === "object" &&
          typeof content.contentBase64 === "string"
        ? content.contentBase64
        : undefined;

  if (typeof contentBase64 !== "string") {
    throw new Error(
      `gmail: attachment ${index} contentBase64 must be a base64 string`,
    );
  }

  const normalized = standardBase64(contentBase64);
  if (normalized === undefined) {
    throw new Error(
      `gmail: attachment ${index} contentBase64 is not valid base64`,
    );
  }
  // A download result passed as contentBase64 names its own file and type.
  const result = typeof content === "object" && content ? content : {};
  const named = (value: unknown) =>
    typeof value === "string" && value ? value : undefined;
  return {
    name:
      input.name ??
      input.filename ??
      named(result.name) ??
      `attachment-${index + 1}`,
    mimeType:
      input.mimeType ?? named(result.mimeType) ?? "application/octet-stream",
    contentBase64: normalized,
  };
}

function attachmentPart(att: NormalizedAttachment): string {
  const encodedName = encodeHeaderWord(att.name);
  return (
    `Content-Type: ${att.mimeType}; name="${encodedName}"${CRLF}` +
    `Content-Disposition: attachment; filename="${encodedName}"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${foldBase64(att.contentBase64)}${CRLF}`
  );
}

/**
 * Build a MIME message and return its base64url-encoded form,
 * ready for `POST /messages/send` under the `raw` field.
 */
export function encodeEmail(email: EmailInput): string {
  const headers: string[] = [];
  if (email.from) headers.push(header("From", email.from));
  headers.push(header("To", email.to));
  if (email.cc) headers.push(header("Cc", email.cc));
  if (email.bcc) headers.push(header("Bcc", email.bcc));
  if (email.replyTo) headers.push(header("Reply-To", email.replyTo));
  if (email.inReplyTo) headers.push(header("In-Reply-To", email.inReplyTo));
  if (email.references) headers.push(header("References", email.references));
  headers.push(header("Subject", encodeHeaderWord(email.subject)));
  headers.push(header("MIME-Version", "1.0"));

  const text = email.text ?? "";
  const html = email.html ?? "";
  const atts = (email.attachments ?? []).map((att, index) =>
    normalizeAttachment(att, index),
  );
  assertAttachmentPayloadFits(atts);
  const hasAtt = atts.length > 0;
  const hasBoth = text && html;

  let bodyBlock: string;
  let rootType: string;

  if (!hasAtt && !hasBoth) {
    // Flat body.
    const mime = html ? "text/html" : "text/plain";
    const content = html || text || "";
    bodyBlock = textPart(content, mime);
    rootType = ""; // already present in bodyBlock
  } else if (!hasAtt && hasBoth) {
    const altBoundary = randomBoundary();
    rootType = `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}`;
    bodyBlock =
      `--${altBoundary}${CRLF}${textPart(text, "text/plain")}` +
      `--${altBoundary}${CRLF}${textPart(html, "text/html")}` +
      `--${altBoundary}--${CRLF}`;
  } else {
    // Attachments present → multipart/mixed wrapping.
    const mixedBoundary = randomBoundary();
    rootType = `Content-Type: multipart/mixed; boundary="${mixedBoundary}"${CRLF}${CRLF}`;
    let inner: string;
    if (hasBoth) {
      const altBoundary = randomBoundary();
      inner =
        `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}` +
        `--${altBoundary}${CRLF}${textPart(text, "text/plain")}` +
        `--${altBoundary}${CRLF}${textPart(html, "text/html")}` +
        `--${altBoundary}--${CRLF}`;
    } else {
      const mime = html ? "text/html" : "text/plain";
      const content = html || text || "";
      inner = textPart(content, mime);
    }
    bodyBlock =
      `--${mixedBoundary}${CRLF}${inner}` +
      atts
        .map((a) => `--${mixedBoundary}${CRLF}${attachmentPart(a)}`)
        .join("") +
      `--${mixedBoundary}--${CRLF}`;
  }

  const raw = `${headers.join("")}${rootType}${bodyBlock}`;
  const rawBytes = Buffer.byteLength(raw, "utf-8");
  if (rawBytes > GMAIL_MAX_RAW_BYTES) {
    throw new Error(
      `gmail: encoded message is ${rawBytes} bytes; Gmail API raw messages must be <= ${GMAIL_MAX_RAW_BYTES} bytes`,
    );
  }
  return base64url(raw);
}

// ─── Email address helpers ───────────────────────────────────────

/**
 * Normalize a comma-separated list of addresses into an RFC-5322
 * address list. Bare `addr@x` becomes `<addr@x>`; anything already
 * formatted as `Name <addr@x>` or `<addr@x>` is preserved. Each
 * entry must contain `@`.
 */
function normalizeAddressList(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const p of parts) {
    if (!p.includes("@")) {
      throw new Error(`gmail: invalid email address "${p}"`);
    }
  }
  return parts
    .map((p) => (p.includes("<") && p.includes(">") ? p : `<${p}>`))
    .join(", ");
}

// ─── Body resolution ─────────────────────────────────────────────

/**
 * Resolve the outgoing body for send/reply/draft: `jsx` renders to
 * html with a generated plain-text alternative; an explicit `text`
 * wins over the generated fallback so every jsx email still ships
 * multipart/alternative.
 * Composing inputs carry no `html` field — jsx is the only HTML path
 * (raw HTML embeds go through dangerouslySetInnerHTML inside jsx).
 */
async function resolveBody(
  p: Record<string, unknown>,
): Promise<{ text?: string; html?: string }> {
  let text = p.text as string | undefined;
  let html: string | undefined;
  if (typeof p.jsx === "string" && p.jsx.trim()) {
    let rendered: { html: string; text: string };
    try {
      rendered = await renderEmailJsx(p.jsx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`gmail: ${msg}`);
    }
    html = rendered.html;
    text ??= rendered.text;
  }
  return { text, html };
}

// ─── Reply helpers ───────────────────────────────────────────────

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPayload {
  headers?: GmailHeader[];
}
interface GmailMessage {
  id?: string;
  threadId?: string;
  payload?: GmailPayload;
}

function findHeader(
  payload: GmailPayload | undefined,
  name: string,
): string | undefined {
  if (!payload?.headers) return undefined;
  const lower = name.toLowerCase();
  const h = payload.headers.find((h) => h.name.toLowerCase() === lower);
  return h?.value;
}

const REPLY_METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Reply-To",
  "Subject",
  "Message-ID",
];

// ─── Filter sugar ────────────────────────────────────────────────

/**
 * Translate a friendly filter bag into Gmail's list query shape.
 *
 * `sender`, `readStatus`,
 * `receivedAfter`, `receivedBefore` fold into the `q=` search
 * expression (which itself can be combined with an explicit `q`).
 * `labelIds`, `includeSpamTrash`, `pageToken`, `maxResults` pass
 * through as query parameters.
 */
function buildListQuery(input: Record<string, unknown>): Record<string, unknown> {
  const qs: Record<string, unknown> = {};
  const qParts: string[] = [];
  if (typeof input.q === "string" && input.q.length > 0) qParts.push(input.q);
  if (typeof input.sender === "string" && input.sender.length > 0) {
    qParts.push(`from:${input.sender}`);
  }
  if (input.readStatus === "read" || input.readStatus === "unread") {
    qParts.push(`is:${input.readStatus}`);
  }
  const after = toGmailTimestamp(input.receivedAfter);
  if (after !== undefined) qParts.push(`after:${after}`);
  const before = toGmailTimestamp(input.receivedBefore);
  if (before !== undefined) qParts.push(`before:${before}`);
  if (qParts.length > 0) qs.q = qParts.join(" ");
  if (input.labelIds) qs.labelIds = input.labelIds;
  if (input.includeSpamTrash) qs.includeSpamTrash = true;
  if (input.pageToken) qs.pageToken = input.pageToken;
  return qs;
}

function toGmailTimestamp(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") {
    // Accept either seconds or milliseconds; Gmail wants seconds.
    return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  }
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    const num = Number(v);
    if (!Number.isNaN(num)) return toGmailTimestamp(num);
  }
  return undefined;
}

// ─── Simplified output ───────────────────────────────────────────

type LabelMap = Map<string, string>;

async function loadLabelMap(ctx: Ctx): Promise<LabelMap> {
  const res = (await gmailRequest(ctx, "GET", "/labels")) as {
    labels?: Array<{ id: string; name: string }>;
  };
  const map: LabelMap = new Map();
  for (const l of res.labels ?? []) map.set(l.id, l.name);
  return map;
}

interface SimplifiedMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  sizeEstimate?: number;
  internalDate?: string;
  labels?: Array<{ id: string; name: string }>;
  headers?: Record<string, string>;
  From?: string;
  To?: string;
  Cc?: string;
  Bcc?: string;
  Subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    attachmentId?: string;
    name: string;
    mimeType: string;
    size: number;
  }>;
}

/**
 * Walk a Gmail message `payload` tree, collecting decoded text/html
 * bodies and attachment metadata. Binary bytes stay server-side —
 * use `message.getAttachment` to fetch them.
 */
function walkPayload(
  payload: unknown,
  acc: {
    text: string[];
    html: string[];
    attachments: NonNullable<SimplifiedMessage["attachments"]>;
  },
): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as {
    mimeType?: string;
    filename?: string;
    body?: { data?: string; attachmentId?: string; size?: number };
    parts?: unknown[];
  };
  if (Array.isArray(p.parts) && p.parts.length > 0) {
    for (const child of p.parts) walkPayload(child, acc);
    return;
  }
  const body = p.body;
  if (!body) return;
  const isAttachment = !!(p.filename && p.filename.length > 0);
  if (isAttachment) {
    acc.attachments.push({
      attachmentId: body.attachmentId,
      name: p.filename ?? "attachment",
      mimeType: p.mimeType ?? "application/octet-stream",
      size: body.size ?? 0,
    });
    return;
  }
  if (!body.data) return;
  const decoded = Buffer.from(body.data, "base64url").toString("utf-8");
  if (p.mimeType === "text/html") acc.html.push(decoded);
  else acc.text.push(decoded);
}

function simplifyMessage(
  raw: Record<string, unknown>,
  labels: LabelMap,
): SimplifiedMessage {
  const out: SimplifiedMessage = {
    id: raw.id as string | undefined,
    threadId: raw.threadId as string | undefined,
    snippet: raw.snippet as string | undefined,
    sizeEstimate: raw.sizeEstimate as number | undefined,
    internalDate: raw.internalDate as string | undefined,
  };

  const labelIds = (raw.labelIds as string[] | undefined) ?? [];
  if (labelIds.length > 0) {
    out.labels = labelIds.map((id) => ({ id, name: labels.get(id) ?? id }));
  }

  const payload = raw.payload as GmailPayload | undefined;
  if (payload?.headers) {
    const headerMap: Record<string, string> = {};
    for (const h of payload.headers) headerMap[h.name] = h.value;
    out.headers = headerMap;
    for (const key of ["From", "To", "Cc", "Bcc", "Subject"] as const) {
      const v = findHeader(payload, key);
      if (v !== undefined) out[key] = v;
    }
  }

  // Body + attachments only meaningful when format=full was used.
  const acc = {
    text: [] as string[],
    html: [] as string[],
    attachments: [] as NonNullable<SimplifiedMessage["attachments"]>,
  };
  walkPayload(payload, acc);
  if (acc.text.length > 0) out.text = acc.text.join("\n");
  if (acc.html.length > 0) out.html = acc.html.join("\n");
  if (acc.attachments.length > 0) out.attachments = acc.attachments;

  return out;
}

/**
 * Shared reply implementation for message.reply and thread.reply.
 * Fetches the original message's headers, derives recipients based
 * on `replyToSenderOnly` / `replyToRecipientsOnly`, filters out the
 * authenticated user's own address, and sends with `In-Reply-To` +
 * `References` headers plus the original `threadId`.
 */
async function replyToMessage(
  ctx: Ctx,
  messageId: string,
  p: Record<string, unknown>,
): Promise<unknown> {
  // Render before any network round-trip so malformed jsx fails
  // without spending Gmail API calls.
  const { text, html } = await resolveBody(p);

  const original = (await gmailRequest(
    ctx,
    "GET",
    `/messages/${pathSegment(messageId)}`,
    undefined,
    { format: "metadata", metadataHeaders: REPLY_METADATA_HEADERS },
  )) as GmailMessage;

  const subject = findHeader(original.payload, "Subject") ?? "";
  const messageIdHeader = findHeader(original.payload, "Message-ID") ?? "";
  const threadId = original.threadId;

  const profile = (await gmailRequest(ctx, "GET", "/profile")) as {
    emailAddress: string;
  };
  const self = profile.emailAddress.toLowerCase();

  const toList: string[] = [];
  const replyToHeader = findHeader(original.payload, "Reply-To");
  const fromHeader = findHeader(original.payload, "From");
  const toHeader = findHeader(original.payload, "To");

  if (!p.replyToRecipientsOnly) {
    const src = replyToHeader || fromHeader;
    if (src) toList.push(src);
  }
  if (!p.replyToSenderOnly && toHeader) {
    for (const raw of toHeader.split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      if (entry.toLowerCase().includes(self)) continue;
      toList.push(entry);
    }
  }
  const seen = new Set<string>();
  const to = toList
    .filter((addr) => {
      const key = addr.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((addr) =>
      addr.includes("<") && addr.includes(">") ? addr : `<${addr}>`,
    )
    .join(", ");

  const email: EmailInput = {
    to,
    cc: normalizeAddressList(p.cc as string | undefined),
    bcc: normalizeAddressList(p.bcc as string | undefined),
    subject: subject.toLowerCase().startsWith("re:")
      ? subject
      : `Re: ${subject}`,
    text,
    html,
    inReplyTo: messageIdHeader,
    references: messageIdHeader,
    attachments: p.attachments as EmailInput["attachments"],
  };

  const body: Record<string, unknown> = { raw: encodeEmail(email) };
  if (threadId) body.threadId = threadId;
  return gmailRequest(ctx, "POST", "/messages/send", body);
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.labels",
];

// ─── Action input schemas ────────────────────────────────────────

const strict = { additionalProperties: false } as const;
const EmptyInput = t.Object({}, strict);
const IdInput = t.Object({ id: Id }, strict);
const MessageFormat = stringEnum(["minimal", "full", "raw", "metadata"]);
const ThreadFormat = stringEnum(["minimal", "full", "metadata"]);
const ReadStatus = stringEnum(["read", "unread", "both"]);
const LabelListVisibility = stringEnum([
  "labelShow",
  "labelShowIfUnread",
  "labelHide",
]);
const MessageListVisibility = stringEnum(["show", "hide"]);
const MetadataHeaders = t.Array(t.String());
const LabelIds = t.Array(NonEmptyString, { minItems: 1 });
const MaxResults = t.Integer({ minimum: 1, maximum: 500 });

const AttachmentContent = t.Union([t.String(), DownloadedFile]);
const Attachment = t.Object(
  {
    name: t.Optional(t.String()),
    filename: t.Optional(t.String()),
    mimeType: t.Optional(t.String()),
    contentBase64: AttachmentContent,
  },
  strict,
);
const Attachments = t.Array(Attachment);

const Jsx = t.Optional(
  t.String({
    description:
      'React Email JSX expression rendered server-side into client-safe HTML with an auto-generated plain-text alternative — handles cross-client rendering (iOS Mail, Gmail, Outlook). For Hebrew/Arabic set dir on the root: `<Html dir="rtl" lang="he"><Container><Heading>שלום</Heading><Text>גוף ההודעה</Text><Button href="...">אישור</Button></Container></Html>`. To embed pre-rendered HTML from elsewhere: `<Html><Body><div dangerouslySetInnerHTML={{ __html: theHtml }} /></Body></Html>`.',
  }),
);

const HasMessageContent = {
  anyOf: [
    {
      required: ["text"],
      properties: { text: { type: "string", minLength: 1, pattern: "\\S" } },
    },
    {
      required: ["jsx"],
      properties: { jsx: { type: "string", minLength: 1, pattern: "\\S" } },
    },
    {
      required: ["attachments"],
      properties: { attachments: { type: "array", minItems: 1 } },
    },
  ],
} as const;

const ReplyFields = {
  text: t.Optional(t.String()),
  jsx: Jsx,
  cc: t.Optional(t.String()),
  bcc: t.Optional(t.String()),
  replyToSenderOnly: t.Optional(t.Boolean()),
  replyToRecipientsOnly: t.Optional(t.Boolean()),
  attachments: t.Optional(Attachments),
};
const ReplyOptions = {
  ...strict,
  ...HasMessageContent,
  not: {
    required: ["replyToSenderOnly", "replyToRecipientsOnly"],
    properties: {
      replyToSenderOnly: { const: true },
      replyToRecipientsOnly: { const: true },
    },
  },
} as const;

const ListFields = {
  q: t.Optional(t.String({ description: "Gmail search query" })),
  sender: t.Optional(t.String()),
  readStatus: t.Optional(ReadStatus),
  receivedAfter: t.Optional(GoogleTimestamp),
  receivedBefore: t.Optional(GoogleTimestamp),
  labelIds: t.Optional(t.Array(NonEmptyString)),
  maxResults: t.Optional(MaxResults),
  pageToken: t.Optional(t.String()),
  includeSpamTrash: t.Optional(t.Boolean()),
  returnAll: t.Optional(t.Boolean()),
};
const ListInput = t.Object(ListFields, strict);

export default function gmail(rl: RunlinePluginAPI) {
  rl.setName("gmail");
  rl.setVersion("0.1.0");
  rl.setCredential(googleCredential("gmail", SCOPES));

  rl.setOAuth(googleOAuth("gmail", SCOPES, "GMAIL"));

  rl.setConnectionSchema({
    authMethod: { type: "string", required: false, description: "delegated or serviceAccount (legacy configs infer the method)" },
    clientId: {
      type: "string",
      required: false,
      description: "Google OAuth2 client ID",
      env: "GMAIL_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "Google OAuth2 client secret",
      env: "GMAIL_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "OAuth2 refresh token (obtained via login flow)",
      env: "GMAIL_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      description: "Google service account JSON credential",
      env: "GMAIL_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      description: "Google service account email",
      env: "GMAIL_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      description: "Google service account private key",
      env: "GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      description: "User email to impersonate with domain-wide delegation",
      env: "GMAIL_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: {
      type: "string",
      required: false,
      description: "Cached access token (auto-refreshed)",
    },
    accessTokenExpiresAt: {
      type: "number",
      required: false,
      description: "Cached access token expiry (ms since epoch)",
    },
  });

  // ── Message ───────────────────────────────────────────

  rl.registerAction("message.send", {
    access: "write",
    description:
      "Send an email. `text` for plain bodies; `jsx` (React Email) for formatted or RTL (Hebrew/Arabic) bodies — renders client-safe HTML with a text fallback.",
    inputSchema: t.Object(
      {
        to: NonEmptyString,
        subject: t.String(),
        text: t.Optional(t.String({ description: "Plain body" })),
        jsx: Jsx,
        cc: t.Optional(t.String()),
        bcc: t.Optional(t.String()),
        replyTo: t.Optional(t.String()),
        from: t.Optional(
          t.String({ description: 'Override From (e.g. "Name <me@x.com>")' }),
        ),
        threadId: t.Optional(Id),
        attachments: t.Optional(Attachments),
      },
      { ...strict, ...HasMessageContent },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const { text, html } = await resolveBody(p);
      const email: EmailInput = {
        to: normalizeAddressList(p.to as string)!,
        cc: normalizeAddressList(p.cc as string | undefined),
        bcc: normalizeAddressList(p.bcc as string | undefined),
        replyTo: normalizeAddressList(p.replyTo as string | undefined),
        from: p.from as string | undefined,
        subject: (p.subject as string) ?? "",
        text,
        html,
        attachments: p.attachments as EmailInput["attachments"],
      };
      const body: Record<string, unknown> = { raw: encodeEmail(email) };
      if (p.threadId) body.threadId = p.threadId;
      return gmailRequest(ctx, "POST", "/messages/send", body);
    },
  });

  rl.registerAction("message.reply", {
    access: "write",
    description:
      "Reply to a message, preserving threadId and In-Reply-To/References headers. `text` for plain bodies; `jsx` (React Email) for formatted ones.",
    inputSchema: t.Object({ messageId: Id, ...ReplyFields }, ReplyOptions),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return replyToMessage(ctx, p.messageId as string, p);
    },
  });

  rl.registerAction("message.get", {
    access: "read",
    description: "Get a message by ID",
    inputSchema: t.Object(
      {
        id: Id,
        format: t.Optional(MessageFormat),
        metadataHeaders: t.Optional(MetadataHeaders),
        simple: t.Optional(
          t.Boolean({
            description:
              "Flatten headers, resolve labels to names, and decode text/html bodies",
          }),
        ),
      },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      if (p.metadataHeaders) qs.metadataHeaders = p.metadataHeaders;
      const raw = (await gmailRequest(
        ctx,
        "GET",
        `/messages/${pathSegment(p.id)}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      if (!p.simple) return raw;
      const labels = await loadLabelMap(ctx);
      return simplifyMessage(raw, labels);
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description:
      "List messages. Supports Gmail search syntax via `q`, plus friendly filters: sender, readStatus ('read'|'unread'), receivedAfter/Before (ISO string, ms, or seconds).",
    inputSchema: ListInput,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs = buildListQuery(p);
      if (p.returnAll) {
        return paginateAll(ctx, "/messages", "messages", qs);
      }
      if (p.maxResults) qs.maxResults = p.maxResults;
      return gmailRequest(ctx, "GET", "/messages", undefined, qs);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Permanently delete a message",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/messages/${pathSegment(id)}`);
    },
  });

  rl.registerAction("message.trash", {
    access: "write",
    description: "Move a message to trash (recoverable)",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/trash`);
    },
  });

  rl.registerAction("message.untrash", {
    access: "write",
    description: "Remove a message from trash",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/untrash`);
    },
  });

  rl.registerAction("message.markAsRead", {
    access: "write",
    description: "Remove the UNREAD label",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/modify`, {
        removeLabelIds: ["UNREAD"],
      });
    },
  });

  rl.registerAction("message.markAsUnread", {
    access: "write",
    description: "Add the UNREAD label",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/modify`, {
        addLabelIds: ["UNREAD"],
      });
    },
  });

  rl.registerAction("message.addLabels", {
    access: "write",
    description: "Add labels to a message",
    inputSchema: t.Object({ id: Id, labelIds: LabelIds }, strict),
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/modify`, {
        addLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("message.removeLabels", {
    access: "write",
    description: "Remove labels from a message",
    inputSchema: t.Object({ id: Id, labelIds: LabelIds }, strict),
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/messages/${pathSegment(id)}/modify`, {
        removeLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("message.getAttachment", {
    access: "read",
    description:
      "Download an attachment by ID (returns {size, data} where data is base64url)",
    inputSchema: t.Object({ messageId: Id, attachmentId: Id }, strict),
    async execute(input, ctx) {
      const { messageId, attachmentId } = input as {
        messageId: string;
        attachmentId: string;
      };
      return gmailRequest(
        ctx,
        "GET",
        `/messages/${pathSegment(messageId)}/attachments/${pathSegment(attachmentId)}`,
      );
    },
  });

  // ── Thread ────────────────────────────────────────────

  rl.registerAction("thread.get", {
    access: "read",
    description: "Get a thread by ID",
    inputSchema: t.Object(
      {
        id: Id,
        format: t.Optional(ThreadFormat),
        metadataHeaders: t.Optional(MetadataHeaders),
        simple: t.Optional(
          t.Boolean({
            description:
              "Return an array of simplified messages instead of the raw thread",
          }),
        ),
      },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      if (p.metadataHeaders) qs.metadataHeaders = p.metadataHeaders;
      const raw = (await gmailRequest(
        ctx,
        "GET",
        `/threads/${pathSegment(p.id)}`,
        undefined,
        qs,
      )) as { messages?: Record<string, unknown>[] };
      if (!p.simple) return raw;
      const labels = await loadLabelMap(ctx);
      return (raw.messages ?? []).map((m) => simplifyMessage(m, labels));
    },
  });

  rl.registerAction("thread.list", {
    access: "read",
    description:
      "List threads. Same filter sugar as `message.list` (sender, readStatus, receivedAfter/Before).",
    inputSchema: ListInput,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs = buildListQuery(p);
      if (p.returnAll) return paginateAll(ctx, "/threads", "threads", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      return gmailRequest(ctx, "GET", "/threads", undefined, qs);
    },
  });

  rl.registerAction("thread.delete", {
    access: "write",
    description: "Permanently delete a thread",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/threads/${pathSegment(id)}`);
    },
  });

  rl.registerAction("thread.trash", {
    access: "write",
    description: "Move a thread to trash",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/threads/${pathSegment(id)}/trash`);
    },
  });

  rl.registerAction("thread.untrash", {
    access: "write",
    description: "Remove a thread from trash",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/threads/${pathSegment(id)}/untrash`);
    },
  });

  rl.registerAction("thread.addLabels", {
    access: "write",
    description: "Add labels to all messages in a thread",
    inputSchema: t.Object({ id: Id, labelIds: LabelIds }, strict),
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/threads/${pathSegment(id)}/modify`, {
        addLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("thread.removeLabels", {
    access: "write",
    description: "Remove labels from all messages in a thread",
    inputSchema: t.Object({ id: Id, labelIds: LabelIds }, strict),
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/threads/${pathSegment(id)}/modify`, {
        removeLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("thread.reply", {
    access: "write",
    description:
      "Reply to the last message in a thread (convenience wrapper over message.reply). `text` for plain bodies; `jsx` (React Email) for formatted ones.",
    inputSchema: t.Object({ id: Id, ...ReplyFields }, ReplyOptions),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const thread = (await gmailRequest(
        ctx,
        "GET",
        `/threads/${pathSegment(p.id)}`,
        undefined,
        { format: "minimal" },
      )) as { messages?: Array<{ id: string }> };
      const last = thread.messages?.[thread.messages.length - 1];
      if (!last?.id) {
        throw new Error(`gmail: thread ${p.id} has no messages to reply to`);
      }
      return replyToMessage(ctx, last.id, p);
    },
  });

  // ── Draft ─────────────────────────────────────────────

  rl.registerAction("draft.create", {
    access: "write",
    description:
      "Create a draft. `text` for plain bodies; `jsx` (React Email) for formatted ones.",
    inputSchema: t.Object(
      {
        to: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        text: t.Optional(t.String()),
        jsx: Jsx,
        cc: t.Optional(t.String()),
        bcc: t.Optional(t.String()),
        replyTo: t.Optional(t.String()),
        from: t.Optional(t.String()),
        fromAlias: t.Optional(
          t.String({
            description:
              "Send-as alias address (e.g. 'me+alt@x.com'); sets the From header",
          }),
        ),
        threadId: t.Optional(Id),
        attachments: t.Optional(Attachments),
      },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const from =
        (p.from as string | undefined) ?? (p.fromAlias as string | undefined);
      const { text, html } = await resolveBody(p);
      const email: EmailInput = {
        to: normalizeAddressList(p.to as string | undefined) ?? "",
        cc: normalizeAddressList(p.cc as string | undefined),
        bcc: normalizeAddressList(p.bcc as string | undefined),
        replyTo: normalizeAddressList(p.replyTo as string | undefined),
        from,
        subject: (p.subject as string) ?? "",
        text,
        html,
        attachments: p.attachments as EmailInput["attachments"],
      };

      // When threading a draft, fetch the last Message-ID in the
      // thread and set In-Reply-To/References so Gmail places the
      // draft into the conversation correctly.
      if (p.threadId) {
        const thread = (await gmailRequest(
          ctx,
          "GET",
          `/threads/${pathSegment(p.threadId)}`,
          undefined,
          { format: "metadata", metadataHeaders: ["Message-ID"] },
        )) as { messages?: GmailMessage[] };
        const last = thread.messages?.[thread.messages.length - 1];
        const mid = findHeader(last?.payload, "Message-ID");
        if (mid) {
          email.inReplyTo = mid;
          email.references = mid;
        }
      }

      const message: Record<string, unknown> = { raw: encodeEmail(email) };
      if (p.threadId) message.threadId = p.threadId;
      return gmailRequest(ctx, "POST", "/drafts", { message });
    },
  });

  rl.registerAction("draft.get", {
    access: "read",
    description: "Get a draft by ID",
    inputSchema: t.Object(
      { id: Id, format: t.Optional(MessageFormat) },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      return gmailRequest(ctx, "GET", `/drafts/${pathSegment(p.id)}`, undefined, qs);
    },
  });

  rl.registerAction("draft.list", {
    access: "read",
    description: "List drafts",
    inputSchema: t.Object(
      {
        q: t.Optional(t.String()),
        maxResults: t.Optional(MaxResults),
        pageToken: t.Optional(t.String()),
        includeSpamTrash: t.Optional(t.Boolean()),
        returnAll: t.Optional(t.Boolean()),
      },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.q) qs.q = p.q;
      if (p.includeSpamTrash) qs.includeSpamTrash = true;
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.returnAll) return paginateAll(ctx, "/drafts", "drafts", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      return gmailRequest(ctx, "GET", "/drafts", undefined, qs);
    },
  });

  rl.registerAction("draft.delete", {
    access: "write",
    description: "Delete a draft",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/drafts/${pathSegment(id)}`);
    },
  });

  rl.registerAction("draft.send", {
    access: "write",
    description: "Send an existing draft",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", "/drafts/send", { id });
    },
  });

  // ── Label ─────────────────────────────────────────────

  rl.registerAction("label.create", {
    access: "write",
    description: "Create a label",
    inputSchema: t.Object(
      {
        name: NonEmptyString,
        labelListVisibility: t.Optional(LabelListVisibility),
        messageListVisibility: t.Optional(MessageListVisibility),
      },
      strict,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.labelListVisibility) {
        body.labelListVisibility = p.labelListVisibility;
      }
      if (p.messageListVisibility) {
        body.messageListVisibility = p.messageListVisibility;
      }
      return gmailRequest(ctx, "POST", "/labels", body);
    },
  });

  rl.registerAction("label.get", {
    access: "read",
    description: "Get a label by ID",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "GET", `/labels/${pathSegment(id)}`);
    },
  });

  rl.registerAction("label.list", {
    access: "read",
    description: "List all labels",
    inputSchema: EmptyInput,
    async execute(_input, ctx) {
      const res = (await gmailRequest(ctx, "GET", "/labels")) as {
        labels?: unknown[];
      };
      return res.labels ?? [];
    },
  });

  rl.registerAction("label.delete", {
    access: "write",
    description: "Delete a label",
    inputSchema: IdInput,
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/labels/${pathSegment(id)}`);
    },
  });

  rl.registerAction("label.update", {
    access: "write",
    description: "Update a label",
    inputSchema: t.Object(
      {
        id: Id,
        name: t.Optional(NonEmptyString),
        labelListVisibility: t.Optional(LabelListVisibility),
        messageListVisibility: t.Optional(MessageListVisibility),
      },
      {
        ...strict,
        anyOf: [
          { required: ["name"] },
          { required: ["labelListVisibility"] },
          { required: ["messageListVisibility"] },
        ],
      },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.name) body.name = p.name;
      if (p.labelListVisibility) {
        body.labelListVisibility = p.labelListVisibility;
      }
      if (p.messageListVisibility) {
        body.messageListVisibility = p.messageListVisibility;
      }
      return gmailRequest(ctx, "PATCH", `/labels/${pathSegment(p.id)}`, body);
    },
  });

  // ── Profile / aliases ─────────────────────────────────

  rl.registerAction("profile.get", {
    access: "read",
    description: "Get the authenticated user's profile",
    inputSchema: EmptyInput,
    async execute(_input, ctx) {
      return gmailRequest(ctx, "GET", "/profile");
    },
  });

  rl.registerAction("alias.list", {
    access: "read",
    description: "List configured send-as aliases",
    inputSchema: EmptyInput,
    async execute(_input, ctx) {
      const res = (await gmailRequest(ctx, "GET", "/settings/sendAs")) as {
        sendAs?: unknown[];
      };
      return res.sendAs ?? [];
    },
  });
}
