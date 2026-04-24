/**
 * Gmail plugin for runline.
 *
 * Authentication: OAuth2 user flow, seeded once via
 * `runline auth gmail`. The connection stores `clientId`,
 * `clientSecret`, `refreshToken`, plus cached `accessToken` +
 * `accessTokenExpiresAt`. When the cached token is missing or
 * within 60 s of expiry, the plugin refreshes against
 * `https://oauth2.googleapis.com/token` and persists the new
 * token via `ctx.updateConnection`. File-level locking inside
 * runline core keeps concurrent refreshes safe.
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

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

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
  attachments?: Array<{
    name: string;
    mimeType: string;
    /** Base64-encoded file contents. */
    contentBase64: string;
  }>;
}

// ─── OAuth ───────────────────────────────────────────────────────

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_SKEW_MS = 60_000;

async function refreshAccessToken(ctx: Ctx): Promise<string> {
  const cfg = ctx.connection.config as unknown as GmailConfig;
  const { clientId, clientSecret, refreshToken } = cfg;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "gmail: missing clientId/clientSecret/refreshToken. Run the Gmail OAuth helper to seed these.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gmail: token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const expiresAt = Date.now() + data.expires_in * 1000;
  await ctx.updateConnection({
    accessToken: data.access_token,
    accessTokenExpiresAt: expiresAt,
  });
  return data.access_token;
}

async function accessToken(ctx: Ctx): Promise<string> {
  const cfg = ctx.connection.config as unknown as GmailConfig;
  if (
    cfg.accessToken &&
    typeof cfg.accessTokenExpiresAt === "number" &&
    Date.now() < cfg.accessTokenExpiresAt - REFRESH_SKEW_MS
  ) {
    return cfg.accessToken;
  }
  return refreshAccessToken(ctx);
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${API_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const entry of v) url.searchParams.append(k, String(entry));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gmail: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
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

function textPart(body: string, mimeType: "text/plain" | "text/html"): string {
  const encoded = Buffer.from(body, "utf-8").toString("base64");
  // Fold base64 to 76 chars per RFC 2045.
  const folded = encoded.match(/.{1,76}/g)?.join(CRLF) ?? encoded;
  return (
    `Content-Type: ${mimeType}; charset="UTF-8"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${folded}${CRLF}`
  );
}

function attachmentPart(att: {
  name: string;
  mimeType: string;
  contentBase64: string;
}): string {
  const encodedName = encodeHeaderWord(att.name);
  const folded = att.contentBase64.match(/.{1,76}/g)?.join(CRLF) ?? att.contentBase64;
  return (
    `Content-Type: ${att.mimeType}; name="${encodedName}"${CRLF}` +
    `Content-Disposition: attachment; filename="${encodedName}"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    `${folded}${CRLF}`
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
  const atts = email.attachments ?? [];
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

function findHeader(payload: GmailPayload | undefined, name: string): string | undefined {
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
  const acc = { text: [] as string[], html: [] as string[], attachments: [] as NonNullable<SimplifiedMessage["attachments"]> };
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
  if (p.replyToSenderOnly && p.replyToRecipientsOnly) {
    throw new Error(
      "gmail: replyToSenderOnly and replyToRecipientsOnly are mutually exclusive",
    );
  }

  const original = (await gmailRequest(
    ctx,
    "GET",
    `/messages/${messageId}`,
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
    subject: subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`,
    text: p.text as string | undefined,
    html: p.html as string | undefined,
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

export default function gmail(rl: RunlinePluginAPI) {
  rl.setName("gmail");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    // access_type=offline + prompt=consent are both required to
    // make Google return a refresh token. Without them, repeat
    // logins skip the refresh_token field in the response.
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "Do the steps in order — skipping step 4 causes a 403 when you log in.",
      "",
      "1. Create a Google Cloud project (or pick an existing one):",
      "     https://console.cloud.google.com/projectcreate",
      "   Make sure the new project is selected in the top navigation dropdown.",
      "",
      "2. Enable the Gmail API for that project:",
      "     https://console.cloud.google.com/apis/library/gmail.googleapis.com",
      "   Click 'Enable'.",
      "",
      "3. Configure the OAuth consent screen (first time only):",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "   Click 'Get started' and fill in:",
      "     • App name: runline (or whatever)",
      "     • User support email: your email",
      "     • Audience: External",
      "     • Developer contact: your email",
      "   You can skip the Scopes screen — runline declares scopes at auth time.",
      "",
      "4. Add yourself as a test user (required — External apps in Testing mode",
      "   only allow authentication from addresses on this list):",
      "     https://console.cloud.google.com/auth/audience",
      "   Under 'Test users', click '+ Add users' and enter the Gmail address",
      "   you'll use to log in. Consent and refresh tokens expire every 7 days",
      "   while the app is in Testing mode.",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Name: runline (or whatever)",
      "     • Authorized redirect URIs → + Add URI:",
      "         {{redirectUri}}",
      "     • Click Create, then copy the Client ID and Client Secret from the",
      "       dialog — the secret is only shown once.",
      "",
      "6. Paste them below (or re-run with --client-id / --client-secret,",
      "   or export GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET).",
      "",
      "During login you'll see a 'Google hasn't verified this app' warning.",
      "Click 'Advanced → Go to runline (unsafe)' to continue — this is",
      "expected for apps in Testing mode.",
    ],
  });

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: true,
      description: "Google OAuth2 client ID",
      env: "GMAIL_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: true,
      description: "Google OAuth2 client secret",
      env: "GMAIL_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: true,
      description: "OAuth2 refresh token (obtained via login flow)",
      env: "GMAIL_REFRESH_TOKEN",
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
    description: "Send an email",
    inputSchema: {
      to: {
        type: "string",
        required: true,
        description: "Comma-separated recipient list",
      },
      subject: { type: "string", required: true },
      text: { type: "string", required: false, description: "Plain body" },
      html: { type: "string", required: false, description: "HTML body" },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      replyTo: { type: "string", required: false },
      from: {
        type: "string",
        required: false,
        description: 'Override From (e.g. "Name <me@x.com>")',
      },
      threadId: { type: "string", required: false },
      attachments: {
        type: "array",
        required: false,
        description: "[{name, mimeType, contentBase64}]",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const email: EmailInput = {
        to: normalizeAddressList(p.to as string)!,
        cc: normalizeAddressList(p.cc as string | undefined),
        bcc: normalizeAddressList(p.bcc as string | undefined),
        replyTo: normalizeAddressList(p.replyTo as string | undefined),
        from: p.from as string | undefined,
        subject: (p.subject as string) ?? "",
        text: p.text as string | undefined,
        html: p.html as string | undefined,
        attachments: p.attachments as EmailInput["attachments"],
      };
      const body: Record<string, unknown> = { raw: encodeEmail(email) };
      if (p.threadId) body.threadId = p.threadId;
      return gmailRequest(ctx, "POST", "/messages/send", body);
    },
  });

  rl.registerAction("message.reply", {
    description:
      "Reply to a message, preserving threadId and In-Reply-To/References headers",
    inputSchema: {
      messageId: { type: "string", required: true },
      text: { type: "string", required: false },
      html: { type: "string", required: false },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      replyToSenderOnly: { type: "boolean", required: false },
      replyToRecipientsOnly: { type: "boolean", required: false },
      attachments: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return replyToMessage(ctx, p.messageId as string, p);
    },
  });

  rl.registerAction("message.get", {
    description: "Get a message by ID",
    inputSchema: {
      id: { type: "string", required: true },
      format: {
        type: "string",
        required: false,
        description: "minimal | full | raw | metadata (default: full)",
      },
      metadataHeaders: { type: "array", required: false },
      simple: {
        type: "boolean",
        required: false,
        description:
          "Flatten headers, resolve labels to names, and decode text/html bodies",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      if (p.metadataHeaders) qs.metadataHeaders = p.metadataHeaders;
      const raw = (await gmailRequest(
        ctx,
        "GET",
        `/messages/${p.id}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      if (!p.simple) return raw;
      const labels = await loadLabelMap(ctx);
      return simplifyMessage(raw, labels);
    },
  });

  rl.registerAction("message.list", {
    description:
      "List messages. Supports Gmail search syntax via `q`, plus friendly filters: sender, readStatus ('read'|'unread'), receivedAfter/Before (ISO string, ms, or seconds).",
    inputSchema: {
      q: { type: "string", required: false, description: "Gmail search query" },
      sender: { type: "string", required: false },
      readStatus: {
        type: "string",
        required: false,
        description: "read | unread | both (default: both)",
      },
      receivedAfter: {
        type: "string",
        required: false,
        description: "ISO datetime, epoch ms, or epoch seconds",
      },
      receivedBefore: { type: "string", required: false },
      labelIds: { type: "array", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      includeSpamTrash: { type: "boolean", required: false },
      returnAll: {
        type: "boolean",
        required: false,
        description: "Paginate until exhausted",
      },
    },
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
    description: "Permanently delete a message",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/messages/${id}`);
    },
  });

  rl.registerAction("message.trash", {
    description: "Move a message to trash (recoverable)",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${id}/trash`);
    },
  });

  rl.registerAction("message.untrash", {
    description: "Remove a message from trash",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${id}/untrash`);
    },
  });

  rl.registerAction("message.markAsRead", {
    description: "Remove the UNREAD label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${id}/modify`, {
        removeLabelIds: ["UNREAD"],
      });
    },
  });

  rl.registerAction("message.markAsUnread", {
    description: "Add the UNREAD label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/messages/${id}/modify`, {
        addLabelIds: ["UNREAD"],
      });
    },
  });

  rl.registerAction("message.addLabels", {
    description: "Add labels to a message",
    inputSchema: {
      id: { type: "string", required: true },
      labelIds: { type: "array", required: true },
    },
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/messages/${id}/modify`, {
        addLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("message.removeLabels", {
    description: "Remove labels from a message",
    inputSchema: {
      id: { type: "string", required: true },
      labelIds: { type: "array", required: true },
    },
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/messages/${id}/modify`, {
        removeLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("message.getAttachment", {
    description:
      "Download an attachment by ID (returns {size, data} where data is base64url)",
    inputSchema: {
      messageId: { type: "string", required: true },
      attachmentId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { messageId, attachmentId } = input as {
        messageId: string;
        attachmentId: string;
      };
      return gmailRequest(
        ctx,
        "GET",
        `/messages/${messageId}/attachments/${attachmentId}`,
      );
    },
  });

  // ── Thread ────────────────────────────────────────────

  rl.registerAction("thread.get", {
    description: "Get a thread by ID",
    inputSchema: {
      id: { type: "string", required: true },
      format: { type: "string", required: false, description: "minimal | full | metadata" },
      metadataHeaders: { type: "array", required: false },
      simple: {
        type: "boolean",
        required: false,
        description:
          "Return an array of simplified messages instead of the raw thread",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      if (p.metadataHeaders) qs.metadataHeaders = p.metadataHeaders;
      const raw = (await gmailRequest(
        ctx,
        "GET",
        `/threads/${p.id}`,
        undefined,
        qs,
      )) as { messages?: Record<string, unknown>[] };
      if (!p.simple) return raw;
      const labels = await loadLabelMap(ctx);
      return (raw.messages ?? []).map((m) => simplifyMessage(m, labels));
    },
  });

  rl.registerAction("thread.list", {
    description:
      "List threads. Same filter sugar as `message.list` (sender, readStatus, receivedAfter/Before).",
    inputSchema: {
      q: { type: "string", required: false },
      sender: { type: "string", required: false },
      readStatus: { type: "string", required: false },
      receivedAfter: { type: "string", required: false },
      receivedBefore: { type: "string", required: false },
      labelIds: { type: "array", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      includeSpamTrash: { type: "boolean", required: false },
      returnAll: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs = buildListQuery(p);
      if (p.returnAll) return paginateAll(ctx, "/threads", "threads", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      return gmailRequest(ctx, "GET", "/threads", undefined, qs);
    },
  });

  rl.registerAction("thread.delete", {
    description: "Permanently delete a thread",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/threads/${id}`);
    },
  });

  rl.registerAction("thread.trash", {
    description: "Move a thread to trash",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/threads/${id}/trash`);
    },
  });

  rl.registerAction("thread.untrash", {
    description: "Remove a thread from trash",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", `/threads/${id}/untrash`);
    },
  });

  rl.registerAction("thread.addLabels", {
    description: "Add labels to all messages in a thread",
    inputSchema: {
      id: { type: "string", required: true },
      labelIds: { type: "array", required: true },
    },
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/threads/${id}/modify`, {
        addLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("thread.removeLabels", {
    description: "Remove labels from all messages in a thread",
    inputSchema: {
      id: { type: "string", required: true },
      labelIds: { type: "array", required: true },
    },
    async execute(input, ctx) {
      const { id, labelIds } = input as { id: string; labelIds: string[] };
      return gmailRequest(ctx, "POST", `/threads/${id}/modify`, {
        removeLabelIds: labelIds,
      });
    },
  });

  rl.registerAction("thread.reply", {
    description:
      "Reply to the last message in a thread (convenience wrapper over message.reply)",
    inputSchema: {
      id: { type: "string", required: true, description: "Thread ID" },
      text: { type: "string", required: false },
      html: { type: "string", required: false },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      replyToSenderOnly: { type: "boolean", required: false },
      replyToRecipientsOnly: { type: "boolean", required: false },
      attachments: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const thread = (await gmailRequest(
        ctx,
        "GET",
        `/threads/${p.id}`,
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
    description: "Create a draft",
    inputSchema: {
      to: { type: "string", required: false },
      subject: { type: "string", required: false },
      text: { type: "string", required: false },
      html: { type: "string", required: false },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      replyTo: { type: "string", required: false },
      from: { type: "string", required: false },
      fromAlias: {
        type: "string",
        required: false,
        description:
          "Send-as alias address (e.g. 'me+alt@x.com'); sets the From header",
      },
      threadId: { type: "string", required: false },
      attachments: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const from = (p.from as string | undefined) ?? (p.fromAlias as string | undefined);
      const email: EmailInput = {
        to: normalizeAddressList(p.to as string | undefined) ?? "",
        cc: normalizeAddressList(p.cc as string | undefined),
        bcc: normalizeAddressList(p.bcc as string | undefined),
        replyTo: normalizeAddressList(p.replyTo as string | undefined),
        from,
        subject: (p.subject as string) ?? "",
        text: p.text as string | undefined,
        html: p.html as string | undefined,
        attachments: p.attachments as EmailInput["attachments"],
      };

      // When threading a draft, fetch the last Message-ID in the
      // thread and set In-Reply-To/References so Gmail places the
      // draft into the conversation correctly.
      if (p.threadId) {
        const thread = (await gmailRequest(
          ctx,
          "GET",
          `/threads/${p.threadId}`,
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
    description: "Get a draft by ID",
    inputSchema: {
      id: { type: "string", required: true },
      format: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { format: p.format ?? "full" };
      return gmailRequest(ctx, "GET", `/drafts/${p.id}`, undefined, qs);
    },
  });

  rl.registerAction("draft.list", {
    description: "List drafts",
    inputSchema: {
      q: { type: "string", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      includeSpamTrash: { type: "boolean", required: false },
      returnAll: { type: "boolean", required: false },
    },
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
    description: "Delete a draft",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/drafts/${id}`);
    },
  });

  rl.registerAction("draft.send", {
    description: "Send an existing draft",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "POST", "/drafts/send", { id });
    },
  });

  // ── Label ─────────────────────────────────────────────

  rl.registerAction("label.create", {
    description: "Create a label",
    inputSchema: {
      name: { type: "string", required: true },
      labelListVisibility: {
        type: "string",
        required: false,
        description: "labelShow | labelShowIfUnread | labelHide",
      },
      messageListVisibility: {
        type: "string",
        required: false,
        description: "show | hide",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.labelListVisibility) body.labelListVisibility = p.labelListVisibility;
      if (p.messageListVisibility)
        body.messageListVisibility = p.messageListVisibility;
      return gmailRequest(ctx, "POST", "/labels", body);
    },
  });

  rl.registerAction("label.get", {
    description: "Get a label by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "GET", `/labels/${id}`);
    },
  });

  rl.registerAction("label.list", {
    description: "List all labels",
    async execute(_input, ctx) {
      const res = (await gmailRequest(ctx, "GET", "/labels")) as {
        labels?: unknown[];
      };
      return res.labels ?? [];
    },
  });

  rl.registerAction("label.delete", {
    description: "Delete a label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return gmailRequest(ctx, "DELETE", `/labels/${id}`);
    },
  });

  rl.registerAction("label.update", {
    description: "Update a label",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: false },
      labelListVisibility: { type: "string", required: false },
      messageListVisibility: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.name) body.name = p.name;
      if (p.labelListVisibility) body.labelListVisibility = p.labelListVisibility;
      if (p.messageListVisibility)
        body.messageListVisibility = p.messageListVisibility;
      return gmailRequest(ctx, "PATCH", `/labels/${p.id}`, body);
    },
  });

  // ── Profile / aliases ─────────────────────────────────

  rl.registerAction("profile.get", {
    description: "Get the authenticated user's profile",
    async execute(_input, ctx) {
      return gmailRequest(ctx, "GET", "/profile");
    },
  });

  rl.registerAction("alias.list", {
    description: "List configured send-as aliases",
    async execute(_input, ctx) {
      const res = (await gmailRequest(ctx, "GET", "/settings/sendAs")) as {
        sendAs?: unknown[];
      };
      return res.sendAs ?? [];
    },
  });
}
