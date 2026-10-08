/**
 * Attachment input normalization and upload to Graph.
 *
 * Input conventions follow runline's built-in gmail/googleDrive plugins —
 * every attachment supplies its bytes exactly one way:
 *
 *   contentBase64  base64 string, or an object carrying `contentBase64` or
 *                  `base64` (so a googleDrive / microsoftFiles download
 *                  result can be passed straight through)
 *   base64         alias of contentBase64 (microsoftFiles.download shape)
 *   contentPath    a file on the host, read at call time
 *   content        a UTF-8 string (e.g. a generated CSV)
 *
 * Graph accepts a file attachment in one POST only below 3 MB; 3–150 MB
 * goes through an upload session on a draft, PUT in chunks straight to
 * the pre-authorized Outlook upload URL (which must not carry a bearer).
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { AuthError, type ActionContext } from "runline";
import { requestFailed } from "../../_shared/credentials.js";
import { graphRequest, userBase } from "../../_shared/microsoftAuth.js";

/**
 * A Graph message or attachment id as one path segment, percent-encoded as
 * the Microsoft plugins have always sent it (ids carry `+` and `=`). An
 * empty or dot id is refused here; the transport refuses an encoded slash.
 */
export function idSegment(value: unknown): string {
  const raw = value === undefined || value === null ? "" : String(value);
  if (!raw || raw === "." || raw === "..")
    throw new AuthError("request_not_allowed");
  return encodeURIComponent(raw);
}

/** Graph's limit for a single-POST file attachment (and for an upload session's minimum). */
export const INLINE_LIMIT = 3 * 1024 * 1024;
/** Graph's per-attachment ceiling for upload sessions. */
export const MAX_ATTACHMENT = 150 * 1024 * 1024;
/** Chunk size for upload sessions: under Graph's 4 MB per-PUT cap, a multiple of 320 KiB. */
export const CHUNK = 12 * 320 * 1024;

export interface AttachmentInput {
  name?: string;
  filename?: string;
  contentType?: string;
  mimeType?: string;
  contentBase64?: string | { contentBase64?: unknown; base64?: unknown };
  base64?: string;
  contentPath?: string;
  content?: string;
  /** Inline (embedded) attachment, referenced from an HTML body as `cid:<contentId>`. */
  inline?: boolean;
  isInline?: boolean;
  contentId?: string;
}

export interface Attachment {
  name: string;
  contentType: string;
  bytes: Buffer;
  isInline: boolean;
  contentId?: string;
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ics": "text/calendar",
  ".eml": "message/rfc822",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
};

export function guessContentType(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
}

function decodeBase64(value: string, label: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact) || compact.length % 4 === 1)
    throw new Error(`${label}: contentBase64 is not valid base64`);
  return Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64Of(input: AttachmentInput): string | undefined {
  const c = input.contentBase64;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    if (typeof c.contentBase64 === "string") return c.contentBase64;
    if (typeof c.base64 === "string") return c.base64;
  }
  return typeof input.base64 === "string" ? input.base64 : undefined;
}

/** Resolve one attachment input to bytes + metadata, or throw a precise error. */
export async function normalizeAttachment(
  input: AttachmentInput,
  index: number,
  plugin: string,
): Promise<Attachment> {
  const label = `${plugin}: attachment ${index}`;
  if (!input || typeof input !== "object")
    throw new Error(`${label} must be an object`);

  const b64 = base64Of(input);
  const sources = [
    b64 !== undefined,
    input.contentPath !== undefined,
    input.content !== undefined,
  ].filter(Boolean).length;
  if (sources !== 1)
    throw new Error(
      `${label} needs exactly one of contentBase64, contentPath or content`,
    );

  let bytes: Buffer;
  let fallbackName = `attachment-${index + 1}`;
  if (b64 !== undefined) {
    bytes = decodeBase64(b64, label);
  } else if (input.contentPath !== undefined) {
    if (typeof input.contentPath !== "string" || !input.contentPath)
      throw new Error(`${label}: contentPath must be a non-empty string`);
    const info = await stat(input.contentPath).catch(() => undefined);
    if (!info?.isFile())
      throw new Error(`${label}: no file at ${input.contentPath}`);
    if (info.size > MAX_ATTACHMENT)
      throw new Error(
        `${label}: ${info.size} bytes exceeds Graph's 150 MB attachment limit`,
      );
    bytes = await readFile(input.contentPath);
    fallbackName = basename(input.contentPath);
  } else {
    if (typeof input.content !== "string")
      throw new Error(`${label}: content must be a string`);
    bytes = Buffer.from(input.content, "utf-8");
    fallbackName = `attachment-${index + 1}.txt`;
  }

  if (bytes.length > MAX_ATTACHMENT)
    throw new Error(
      `${label}: ${bytes.length} bytes exceeds Graph's 150 MB attachment limit`,
    );

  const name = input.name ?? input.filename ?? fallbackName;
  const isInline = Boolean(input.inline ?? input.isInline);
  if (isInline && !input.contentId)
    throw new Error(`${label}: an inline attachment needs a contentId`);
  return {
    name,
    contentType: input.contentType ?? input.mimeType ?? guessContentType(name),
    bytes,
    isInline,
    ...(input.contentId ? { contentId: input.contentId } : {}),
  };
}

export function normalizeAll(
  inputs: AttachmentInput[] | undefined,
  plugin: string,
): Promise<Attachment[]> {
  if (inputs !== undefined && !Array.isArray(inputs))
    throw new Error(`${plugin}: attachments must be an array`);
  return Promise.all(
    (inputs ?? []).map((a, i) => normalizeAttachment(a, i, plugin)),
  );
}

/** The Graph `fileAttachment` resource for a single-POST attachment. */
export function fileAttachment(a: Attachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.bytes.toString("base64"),
    isInline: a.isInline,
    ...(a.contentId ? { contentId: a.contentId } : {}),
  };
}

/** Whether a set of attachments fits inside one JSON request with the message. */
export function fitsInline(atts: Attachment[]): boolean {
  return atts.reduce((sum, a) => sum + a.bytes.length, 0) < INLINE_LIMIT;
}

/** Where Graph calls for one action go: the plugin's name and the scopes it asks for. */
export interface MailGraph {
  ctx: ActionContext;
  plugin: string;
  scopes: string[];
}

/** Outlook's pre-authorized upload hosts (commercial + national clouds). */
const UPLOAD_HOSTS = [
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.office365.us",
  "outlook.apps.mil",
  "partner.outlook.cn",
];

function checkUploadUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    if (
      url.protocol === "https:" &&
      !url.port &&
      UPLOAD_HOSTS.some(
        (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
      )
    )
      return url.toString();
  } catch {
    // fall through
  }
  throw new Error("microsoftMail: Graph returned an unexpected upload URL");
}

export interface AddedAttachment {
  id?: string;
  name: string;
  size: number;
  contentType: string;
  isInline: boolean;
  method: "inline" | "uploadSession";
}

/** Add one attachment to a draft message, choosing single POST vs upload session by size. */
export async function addAttachment(
  graph: MailGraph,
  messageId: string,
  a: Attachment,
): Promise<AddedAttachment> {
  const { ctx, plugin, scopes } = graph;
  const base = `${userBase(ctx)}/messages/${idSegment(messageId)}/attachments`;
  const summary = {
    name: a.name,
    size: a.bytes.length,
    contentType: a.contentType,
    isInline: a.isInline,
  };

  if (a.bytes.length < INLINE_LIMIT) {
    const r = await graphRequest<{ id?: string }>(
      ctx,
      plugin,
      scopes,
      "POST",
      base,
      fileAttachment(a),
    );
    return { id: r.id, ...summary, method: "inline" };
  }

  const session = await graphRequest<{ uploadUrl?: string }>(
    ctx,
    plugin,
    scopes,
    "POST",
    `${base}/createUploadSession`,
    {
      AttachmentItem: {
        attachmentType: "file",
        name: a.name,
        size: a.bytes.length,
        contentType: a.contentType,
        isInline: a.isInline,
        ...(a.contentId ? { contentId: a.contentId } : {}),
      },
    },
  );
  const uploadUrl = checkUploadUrl(session.uploadUrl);

  let id: string | undefined;
  const total = a.bytes.length;
  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    const res = await globalThis.fetch(uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: {
        // Content-Length is set by fetch from the byte body.
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: new Uint8Array(a.bytes.subarray(start, end)),
    });
    if (!res.ok) {
      // Best effort: cancel the session so no partial attachment lingers.
      await globalThis
        .fetch(uploadUrl, { method: "DELETE", redirect: "error" })
        .catch(() => undefined);
      throw requestFailed(plugin, res.status);
    }
    if (end === total) {
      const location = res.headers.get("location") ?? "";
      id = /Attachments\('([^']+)'\)/i.exec(location)?.[1];
    }
    await res.body?.cancel().catch(() => undefined);
  }
  return { ...(id ? { id } : {}), ...summary, method: "uploadSession" };
}
