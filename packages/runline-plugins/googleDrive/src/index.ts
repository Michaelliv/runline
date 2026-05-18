/**
 * Google Drive plugin for runline.
 *
 * Authentication mirrors gmail / googleCalendar: OAuth2 user flow,
 * seeded via `runline auth googleDrive`. Token refresh is lazy
 * (60 s skew) and cached on the connection.
 *
 * Surface area:
 *
 *   file.upload / file.createFromText / file.download /
 *   file.copy / file.move / file.update / file.delete /
 *   file.share / file.get
 *
 *   folder.create / folder.delete / folder.share
 *
 *   fileFolder.search            (unified search with filter sugar)
 *
 *   drive.create / drive.get / drive.list / drive.update / drive.delete
 *     (Shared Drives / Team Drives)
 *
 *   comment.list / comment.get / comment.create / comment.update /
 *   comment.delete / comment.resolve / comment.reopen
 *   reply.list / reply.create / reply.update / reply.delete
 *
 *   revision.list / revision.get / revision.download /
 *   revision.update / revision.delete / revision.restore
 *     (Office-file comments live inside the bytes; revision.* is the
 *      recovery path when file.update overwrites a working draft.)
 *
 *   changes.getStartPageToken / changes.list / changes.watch / changes.stop
 *     (Drive change feed.)
 *
 *   permission.update — patch an existing share role / expiration.
 *   accessProposal.list / accessProposal.resolve — Drive's "Request access" flow.
 *   about.get — current user, quota, export formats.
 *   file.export — native-doc export wrapper.
 *   file.list — raw files.list (the wrapper is fileFolder.search).
 *
 * Binary content conventions — every upload/download surface
 * speaks base64 or filesystem paths:
 *
 *   • upload / createFromText / update accept either:
 *       contentBase64  — base64-encoded bytes
 *       contentPath    — filesystem path, read at call time
 *       content        — utf-8 string (createFromText only)
 *
 *   • download returns { name, mimeType, contentBase64 } by default,
 *     or writes to disk when `savePath` is provided and returns the
 *     path it wrote to.
 *
 * Uploads use multipart/related (`uploadType=multipart`) up to ~5 MB,
 * and resumable uploads (`uploadType=resumable`) with 2 MiB chunks
 * for larger files, driven off whether the caller supplies bytes
 * (Buffer) vs a path (streamed).
 */

import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import type { ActionContext, RunlinePluginAPI } from "runline";
import { googleAccessToken } from "../../_shared/googleAuth.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleDriveConfig = {
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

interface PermissionInput {
  role: "owner" | "organizer" | "fileOrganizer" | "writer" | "commenter" | "reader";
  type: "user" | "group" | "domain" | "anyone";
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
}

// ─── MIME constants ──────────────────────────────────────────────

const DRIVE = {
  FOLDER: "application/vnd.google-apps.folder",
  DOCUMENT: "application/vnd.google-apps.document",
  SPREADSHEET: "application/vnd.google-apps.spreadsheet",
  PRESENTATION: "application/vnd.google-apps.presentation",
  DRAWING: "application/vnd.google-apps.drawing",
  FORM: "application/vnd.google-apps.form",
  AUDIO: "application/vnd.google-apps.audio",
  VIDEO: "application/vnd.google-apps.video",
  PHOTO: "application/vnd.google-apps.photo",
  MAP: "application/vnd.google-apps.map",
  SITES: "application/vnd.google-apps.sites",
  APP_SCRIPTS: "application/vnd.google-apps.script",
  SDK: "application/vnd.google-apps.drive-sdk",
  FILE: "application/vnd.google-apps.file",
  FUSIONTABLE: "application/vnd.google-apps.fusiontable",
  UNKNOWN: "application/vnd.google-apps.unknown",
} as const;

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleDrive", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://www.googleapis.com";

async function driveRequest(
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
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`googleDrive: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

/**
 * Paginate any Drive list endpoint by repeatedly following
 * `nextPageToken`. Works for `/drive/v3/files`, `/drive/v3/drives`,
 * etc. Returns the concatenated `key` arrays.
 */
async function paginateAll(
  ctx: Ctx,
  path: string,
  key: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = { ...qs, pageSize: qs.pageSize ?? 100 };
  do {
    const page = (await driveRequest(ctx, "GET", path, undefined, query)) as {
      [k: string]: unknown;
      nextPageToken?: string;
    };
    const items = (page[key] as Record<string, unknown>[]) ?? [];
    out.push(...items);
    query.pageToken = page.nextPageToken;
  } while (query.pageToken);
  return out;
}

// ─── Binary I/O helpers ─────────────────────────────────────────

/**
 * Resolve whichever of `contentBase64` / `contentPath` / `content` the
 * caller provided into a Buffer, plus a best-guess filename and
 * mimeType. For resumable uploads we keep paths as paths so we can
 * stream instead of buffering 500 MB in memory.
 */
function resolveContent(p: Record<string, unknown>): {
  buffer?: Buffer;
  path?: string;
  size: number;
  mimeType?: string;
  fileName?: string;
} {
  if (typeof p.contentBase64 === "string") {
    const buf = Buffer.from(p.contentBase64, "base64");
    return {
      buffer: buf,
      size: buf.byteLength,
      mimeType: p.mimeType as string | undefined,
      fileName: p.name as string | undefined,
    };
  }
  if (typeof p.content === "string") {
    const buf = Buffer.from(p.content, "utf-8");
    return {
      buffer: buf,
      size: buf.byteLength,
      mimeType: (p.mimeType as string | undefined) ?? "text/plain",
      fileName: p.name as string | undefined,
    };
  }
  if (typeof p.contentPath === "string") {
    const stat = statSync(p.contentPath);
    // Under 5 MiB → buffer it for a simple multipart upload. Larger
    // files go through resumable with a streamed ReadStream.
    const BUFFER_THRESHOLD = 5 * 1024 * 1024;
    const fileName = (p.name as string | undefined) ?? p.contentPath.split("/").pop();
    if (stat.size <= BUFFER_THRESHOLD) {
      return {
        buffer: readFileSync(p.contentPath),
        size: stat.size,
        mimeType: p.mimeType as string | undefined,
        fileName,
      };
    }
    return {
      path: p.contentPath,
      size: stat.size,
      mimeType: p.mimeType as string | undefined,
      fileName,
    };
  }
  throw new Error(
    "googleDrive: provide one of contentBase64 / contentPath / content",
  );
}

const MULTIPART_BOUNDARY = "runline_drive_boundary";

/**
 * Build a multipart/related body for Drive's simple upload endpoint.
 * Spec: https://developers.google.com/drive/api/guides/manage-uploads#multipart
 */
function buildMultipart(
  metadata: Record<string, unknown>,
  content: Buffer,
  mimeType: string,
): Buffer {
  const boundary = MULTIPART_BOUNDARY;
  const meta =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return Buffer.concat([Buffer.from(meta, "utf-8"), content, Buffer.from(tail, "utf-8")]);
}

/**
 * Upload bytes to Drive. Picks multipart vs resumable based on whether
 * `c` holds an in-memory Buffer (small) or a filesystem path (streamed).
 * Returns Drive's file resource (`{ id, name, ... }`).
 */
async function uploadBytes(
  ctx: Ctx,
  metadata: Record<string, unknown>,
  c: {
    buffer?: Buffer;
    path?: string;
    size: number;
    mimeType?: string;
  },
  extraQs: Record<string, unknown> = {},
): Promise<{ id: string } & Record<string, unknown>> {
  const mimeType = c.mimeType ?? "application/octet-stream";
  const token = await accessToken(ctx);

  if (c.buffer) {
    const body = buildMultipart(metadata, c.buffer, mimeType);
    const url = new URL(`${API_BASE}/upload/drive/v3/files`);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("supportsAllDrives", "true");
    for (const [k, v] of Object.entries(extraQs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
        "Content-Length": String(body.byteLength),
      },
      // Buffer is a Uint8Array so it's a valid BodyInit.
      body: new Uint8Array(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`googleDrive: upload failed (${res.status}): ${text}`);
    }
    return JSON.parse(text);
  }

  // Resumable: initiate, then PUT chunks.
  const initUrl = new URL(`${API_BASE}/upload/drive/v3/files`);
  initUrl.searchParams.set("uploadType", "resumable");
  initUrl.searchParams.set("supportsAllDrives", "true");
  for (const [k, v] of Object.entries(extraQs)) {
    if (v !== undefined) initUrl.searchParams.set(k, String(v));
  }
  const initRes = await fetch(initUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(c.size),
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const t = await initRes.text();
    throw new Error(`googleDrive: resumable init failed (${initRes.status}): ${t}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("googleDrive: resumable session missing Location header");

  // Stream in 2 MiB chunks. Must be a multiple of 256 KiB per Drive docs.
  const CHUNK_SIZE = 2 * 1024 * 1024;
  const stream = createReadStream(c.path!, { highWaterMark: CHUNK_SIZE });
  let offset = 0;
  let pending: Buffer = Buffer.alloc(0);
  let lastBody = "";
  let lastStatus = 0;

  const flushChunk = async (chunk: Buffer, isLast: boolean): Promise<void> => {
    const start = offset;
    const end = offset + chunk.byteLength - 1;
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end}/${c.size}`,
      },
      body: new Uint8Array(chunk),
    });
    offset += chunk.byteLength;
    lastStatus = res.status;
    // 308 == "Resume Incomplete" — expected for all but the final chunk.
    if (res.status === 200 || res.status === 201) {
      lastBody = await res.text();
    } else if (res.status === 308) {
      // Discard body, keep streaming.
      await res.text();
    } else {
      const t = await res.text();
      throw new Error(`googleDrive: resumable chunk failed (${res.status}): ${t}`);
    }
    void isLast;
  };

  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    while (pending.byteLength >= CHUNK_SIZE) {
      const head = pending.subarray(0, CHUNK_SIZE);
      pending = pending.subarray(CHUNK_SIZE);
      await flushChunk(head, false);
    }
  }
  if (pending.byteLength > 0) {
    await flushChunk(pending, true);
  }
  if (lastStatus !== 200 && lastStatus !== 201) {
    throw new Error(
      `googleDrive: resumable upload ended with status ${lastStatus} and no file resource`,
    );
  }
  return JSON.parse(lastBody);
}

// ─── Shared helpers ─────────────────────────────────────────────

function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return undefined;
}

/**
 * Apply the "My Drive / shared drive / folder" scoping rules on
 * file/folder list & search queries. A non-default `driveId`
 * narrows corpora to that drive; otherwise we list the user's
 * corpus.
 */
function applyDriveScopes(
  qs: Record<string, unknown>,
  driveId?: string,
): void {
  if (driveId) {
    qs.driveId = driveId;
    qs.corpora = "drive";
    qs.includeItemsFromAllDrives = true;
    qs.supportsAllDrives = true;
  } else {
    qs.corpora = "user";
    qs.spaces = "drive";
    qs.includeItemsFromAllDrives = false;
    qs.supportsAllDrives = false;
  }
}

function resolveParent(folderId?: string, driveId?: string): string {
  if (folderId && folderId !== "root") return folderId;
  if (driveId) return driveId;
  return "root";
}

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/drive"];

export default function googleDrive(rl: RunlinePluginAPI) {
  rl.setName("googleDrive");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the Google Drive API:",
      "     https://console.cloud.google.com/apis/library/drive.googleapis.com",
      "",
      "3. Configure the OAuth consent screen:",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: false,
      description: "Google OAuth2 client ID",
      env: "GOOGLE_DRIVE_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "Google OAuth2 client secret",
      env: "GOOGLE_DRIVE_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "OAuth2 refresh token",
      env: "GOOGLE_DRIVE_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      description: "Google service account JSON credential",
      env: "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      description: "Google service account email",
      env: "GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      description: "Google service account private key",
      env: "GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      description: "User email to impersonate with domain-wide delegation",
      env: "GOOGLE_DRIVE_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── File ──────────────────────────────────────────────

  rl.registerAction("file.upload", {
    description:
      "Upload a file to Drive. Supply one of contentBase64 / contentPath / content. Uses multipart for small files, resumable (2 MiB chunks) for large streamed paths.",
    inputSchema: {
      name: { type: "string", required: false, description: "File name in Drive" },
      folderId: { type: "string", required: false, description: "Parent folder (default: root)" },
      driveId: { type: "string", required: false, description: "Target shared drive" },
      mimeType: { type: "string", required: false },
      contentBase64: { type: "string", required: false },
      contentPath: { type: "string", required: false, description: "Local filesystem path" },
      content: { type: "string", required: false, description: "Inline utf-8 content" },
      properties: {
        type: "object",
        required: false,
        description: "Public key-value properties",
      },
      appProperties: {
        type: "object",
        required: false,
        description: "App-private key-value properties",
      },
      keepRevisionForever: { type: "boolean", required: false },
      ocrLanguage: { type: "string", required: false },
      useContentAsIndexableText: { type: "boolean", required: false },
      fields: {
        type: "string",
        required: false,
        description: "Fields projection (default: '*' returns everything)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const content = resolveContent(p);
      const metadata: Record<string, unknown> = {
        name: content.fileName ?? "Untitled",
        parents: [resolveParent(p.folderId as string, p.driveId as string)],
      };
      if (p.mimeType) metadata.mimeType = p.mimeType;
      if (p.properties) metadata.properties = p.properties;
      if (p.appProperties) metadata.appProperties = p.appProperties;
      const uploaded = await uploadBytes(ctx, metadata, content);

      // The multipart upload endpoint returns a minimal resource
      // (id, name, mimeType) and doesn't honor the `keepRevisionForever`
      // / `ocrLanguage` / `useContentAsIndexableText` family, so
      // we follow every upload with a PATCH to apply those and to
      // project the full resource.
      const qs: Record<string, unknown> = {
        supportsAllDrives: true,
        fields: p.fields ?? "*",
      };
      if (p.keepRevisionForever) qs.keepRevisionForever = p.keepRevisionForever;
      if (p.ocrLanguage) qs.ocrLanguage = p.ocrLanguage;
      if (p.useContentAsIndexableText)
        qs.useContentAsIndexableText = p.useContentAsIndexableText;
      return driveRequest(ctx, "PATCH", `/drive/v3/files/${uploaded.id}`, {}, qs);
    },
  });

  rl.registerAction("file.createFromText", {
    description:
      "Create a text file from inline content. Set convertToGoogleDocument=true to convert to a Google Doc.",
    inputSchema: {
      name: { type: "string", required: false, description: 'Default: "Untitled"' },
      content: { type: "string", required: true },
      folderId: { type: "string", required: false },
      driveId: { type: "string", required: false },
      convertToGoogleDocument: { type: "boolean", required: false },
      properties: { type: "object", required: false },
      appProperties: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const name = (p.name as string) || "Untitled";
      const asDoc = p.convertToGoogleDocument === true;
      const mimeType = asDoc ? DRIVE.DOCUMENT : "text/plain";

      if (asDoc) {
        // For docs: create the file then fill it via docs.batchUpdate,
        // Drive's upload would upload the raw text as an attachment
        // instead of populating the document body.
        const metadata: Record<string, unknown> = {
          name,
          mimeType,
          parents: [resolveParent(p.folderId as string, p.driveId as string)],
        };
        if (p.properties) metadata.properties = p.properties;
        if (p.appProperties) metadata.appProperties = p.appProperties;
        const doc = (await driveRequest(ctx, "POST", "/drive/v3/files", metadata, {
          supportsAllDrives: true,
        })) as { id: string };

        const token = await accessToken(ctx);
        const res = await fetch(
          `https://docs.googleapis.com/v1/documents/${doc.id}:batchUpdate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              requests: [
                {
                  insertText: {
                    text: p.content,
                    endOfSegmentLocation: { segmentId: "" },
                  },
                },
              ],
            }),
          },
        );
        if (!res.ok) {
          throw new Error(
            `googleDrive: docs.batchUpdate failed (${res.status}): ${await res.text()}`,
          );
        }
        return { id: doc.id };
      }

      // Plain text: ordinary multipart upload.
      const buffer = Buffer.from(String(p.content), "utf-8");
      const metadata: Record<string, unknown> = {
        name,
        parents: [resolveParent(p.folderId as string, p.driveId as string)],
        mimeType,
      };
      if (p.properties) metadata.properties = p.properties;
      if (p.appProperties) metadata.appProperties = p.appProperties;
      return uploadBytes(ctx, metadata, {
        buffer,
        size: buffer.byteLength,
        mimeType,
      });
    },
  });

  rl.registerAction("file.download", {
    description:
      "Download a file. Google-native docs are exported to the chosen format; regular files are downloaded as-is. Returns base64 by default, or writes to disk when savePath is set.",
    inputSchema: {
      fileId: { type: "string", required: true },
      savePath: {
        type: "string",
        required: false,
        description: "Write bytes to this filesystem path instead of returning base64",
      },
      googleDocFormat: {
        type: "string",
        required: false,
        description:
          "Export MIME type for Google Docs (default: DOCX / PPTX / XLSX / image/jpeg by type)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const meta = (await driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${fileId}`,
        undefined,
        { fields: "mimeType,name", supportsAllDrives: true },
      )) as { mimeType: string; name: string };

      const isGoogleNative = meta.mimeType?.includes("vnd.google-apps");
      const token = await accessToken(ctx);
      let url: string;
      let contentType = meta.mimeType;
      if (isGoogleNative) {
        const type = meta.mimeType.split(".")[2];
        const defaults: Record<string, string> = {
          document:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          spreadsheet:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          presentation:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          drawing: "image/jpeg",
        };
        const mime = (p.googleDocFormat as string | undefined) ?? defaults[type] ?? "application/pdf";
        contentType = mime;
        const u = new URL(`${API_BASE}/drive/v3/files/${fileId}/export`);
        u.searchParams.set("mimeType", mime);
        u.searchParams.set("supportsAllDrives", "true");
        url = u.toString();
      } else {
        const u = new URL(`${API_BASE}/drive/v3/files/${fileId}`);
        u.searchParams.set("alt", "media");
        u.searchParams.set("supportsAllDrives", "true");
        url = u.toString();
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`googleDrive: download failed (${res.status}): ${await res.text()}`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const fileName = meta.name;

      if (typeof p.savePath === "string") {
        writeFileSync(p.savePath, bytes);
        return { path: p.savePath, name: fileName, mimeType: contentType, size: bytes.byteLength };
      }
      return {
        name: fileName,
        mimeType: contentType,
        size: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      };
    },
  });

  rl.registerAction("file.copy", {
    description: "Copy a file",
    inputSchema: {
      fileId: { type: "string", required: true },
      name: { type: "string", required: false, description: 'Default: "Copy of {original}"' },
      folderId: {
        type: "string",
        required: false,
        description: "If omitted, copy stays in the same folder(s)",
      },
      driveId: { type: "string", required: false },
      description: { type: "string", required: false },
      copyRequiresWriterPermission: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.name) body.name = p.name;
      if (p.description) body.description = p.description;
      if (p.copyRequiresWriterPermission !== undefined) {
        body.copyRequiresWriterPermission = p.copyRequiresWriterPermission;
      }
      if (p.folderId || p.driveId) {
        body.parents = [resolveParent(p.folderId as string, p.driveId as string)];
      }
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/copy`,
        body,
        { supportsAllDrives: true },
      );
    },
  });

  rl.registerAction("file.move", {
    description:
      "Move a file to another folder. Resolves current parents and swaps them in a single PATCH.",
    inputSchema: {
      fileId: { type: "string", required: true },
      folderId: { type: "string", required: false, description: "Destination folder" },
      driveId: { type: "string", required: false, description: "Destination shared drive" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const current = (await driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${p.fileId}`,
        undefined,
        { fields: "parents", supportsAllDrives: true },
      )) as { parents?: string[] };
      const removeParents = (current.parents ?? []).join(",");
      const addParents = resolveParent(p.folderId as string, p.driveId as string);
      return driveRequest(
        ctx,
        "PATCH",
        `/drive/v3/files/${p.fileId}`,
        undefined,
        {
          supportsAllDrives: true,
          addParents,
          removeParents,
        },
      );
    },
  });

  rl.registerAction("file.update", {
    description:
      "Patch file metadata and/or replace its bytes. Supply content{Base64,Path} to update bytes.",
    inputSchema: {
      fileId: { type: "string", required: true },
      name: { type: "string", required: false },
      mimeType: { type: "string", required: false },
      trashed: { type: "boolean", required: false, description: "Move to trash" },
      properties: { type: "object", required: false },
      appProperties: { type: "object", required: false },
      contentBase64: { type: "string", required: false },
      contentPath: { type: "string", required: false },
      keepRevisionForever: { type: "boolean", required: false },
      ocrLanguage: { type: "string", required: false },
      useContentAsIndexableText: { type: "boolean", required: false },
      fields: { type: "string", required: false, description: "Fields projection" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const hasBytes = p.contentBase64 !== undefined || p.contentPath !== undefined;

      // Step 1: upload new bytes if provided. Drive requires PATCH on
      // the upload endpoint for content replacement.
      if (hasBytes) {
        const c = resolveContent(p);
        const mimeType = c.mimeType ?? (p.mimeType as string) ?? "application/octet-stream";
        const token = await accessToken(ctx);
        if (c.buffer) {
          const url = new URL(`${API_BASE}/upload/drive/v3/files/${fileId}`);
          url.searchParams.set("uploadType", "media");
          url.searchParams.set("supportsAllDrives", "true");
          const res = await fetch(url.toString(), {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": mimeType,
              "Content-Length": String(c.buffer.byteLength),
            },
            body: new Uint8Array(c.buffer),
          });
          if (!res.ok) {
            throw new Error(
              `googleDrive: content update failed (${res.status}): ${await res.text()}`,
            );
          }
        } else if (c.path) {
          // Resumable PATCH
          const initUrl = new URL(`${API_BASE}/upload/drive/v3/files/${fileId}`);
          initUrl.searchParams.set("uploadType", "resumable");
          initUrl.searchParams.set("supportsAllDrives", "true");
          const initRes = await fetch(initUrl.toString(), {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Upload-Content-Type": mimeType,
              "X-Upload-Content-Length": String(c.size),
            },
          });
          if (!initRes.ok) {
            throw new Error(
              `googleDrive: resumable update init failed (${initRes.status}): ${await initRes.text()}`,
            );
          }
          const uploadUrl = initRes.headers.get("location");
          if (!uploadUrl) throw new Error("googleDrive: missing Location on resumable init");
          const CHUNK = 2 * 1024 * 1024;
          const stream = createReadStream(c.path, { highWaterMark: CHUNK });
          let offset = 0;
          let pending = Buffer.alloc(0);
          const flush = async (chunk: Buffer) => {
            const res = await fetch(uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Length": String(chunk.byteLength),
                "Content-Range": `bytes ${offset}-${offset + chunk.byteLength - 1}/${c.size}`,
              },
              body: new Uint8Array(chunk),
            });
            offset += chunk.byteLength;
            if (res.status !== 200 && res.status !== 201 && res.status !== 308) {
              throw new Error(
                `googleDrive: resumable chunk failed (${res.status}): ${await res.text()}`,
              );
            }
            await res.text();
          };
          for await (const chunk of stream) {
            pending = Buffer.concat([pending, chunk as Buffer]);
            while (pending.byteLength >= CHUNK) {
              await flush(pending.subarray(0, CHUNK));
              pending = pending.subarray(CHUNK);
            }
          }
          if (pending.byteLength > 0) await flush(pending);
        }
      }

      // Step 2: metadata patch
      const body: Record<string, unknown> = {};
      if (p.name !== undefined) body.name = p.name;
      if (p.mimeType !== undefined) body.mimeType = p.mimeType;
      if (p.properties !== undefined) body.properties = p.properties;
      if (p.appProperties !== undefined) body.appProperties = p.appProperties;

      const qs: Record<string, unknown> = { supportsAllDrives: true };
      if (p.trashed !== undefined) qs.trashed = p.trashed;
      if (p.keepRevisionForever) qs.keepRevisionForever = p.keepRevisionForever;
      if (p.ocrLanguage) qs.ocrLanguage = p.ocrLanguage;
      if (p.useContentAsIndexableText)
        qs.useContentAsIndexableText = p.useContentAsIndexableText;
      if (p.fields) qs.fields = p.fields;

      if (Object.keys(body).length === 0 && !p.trashed && !p.fields) {
        return { id: fileId, success: true };
      }
      return driveRequest(ctx, "PATCH", `/drive/v3/files/${fileId}`, body, qs);
    },
  });

  rl.registerAction("file.delete", {
    description:
      "Delete a file. Moves to trash by default; pass deletePermanently=true to erase.",
    inputSchema: {
      fileId: { type: "string", required: true },
      deletePermanently: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.deletePermanently) {
        await driveRequest(ctx, "DELETE", `/drive/v3/files/${p.fileId}`, undefined, {
          supportsAllDrives: true,
        });
      } else {
        await driveRequest(
          ctx,
          "PATCH",
          `/drive/v3/files/${p.fileId}`,
          { trashed: true },
          { supportsAllDrives: true },
        );
      }
      return { id: p.fileId, success: true };
    },
  });

  rl.registerAction("file.get", {
    description: "Get file metadata",
    inputSchema: {
      fileId: { type: "string", required: true },
      fields: { type: "string", required: false, description: "Default: '*'" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${p.fileId}`,
        undefined,
        { supportsAllDrives: true, fields: p.fields ?? "*" },
      );
    },
  });

  rl.registerAction("file.share", {
    description:
      "Add a permission to a file. Create one permission per call; list the existing permissions via file.listPermissions.",
    inputSchema: {
      fileId: { type: "string", required: true },
      role: {
        type: "string",
        required: true,
        description: "owner | organizer | fileOrganizer | writer | commenter | reader",
      },
      type: {
        type: "string",
        required: true,
        description: "user | group | domain | anyone",
      },
      emailAddress: { type: "string", required: false },
      domain: { type: "string", required: false },
      allowFileDiscovery: { type: "boolean", required: false },
      emailMessage: { type: "string", required: false },
      sendNotificationEmail: { type: "boolean", required: false },
      transferOwnership: { type: "boolean", required: false },
      moveToNewOwnersRoot: { type: "boolean", required: false },
      useDomainAdminAccess: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as unknown as PermissionInput & {
        fileId: string;
        emailMessage?: string;
        sendNotificationEmail?: boolean;
        transferOwnership?: boolean;
        moveToNewOwnersRoot?: boolean;
        useDomainAdminAccess?: boolean;
      };
      const body: Record<string, unknown> = {
        role: p.role,
        type: p.type,
      };
      if (p.emailAddress) body.emailAddress = p.emailAddress;
      if (p.domain) body.domain = p.domain;
      if (p.allowFileDiscovery !== undefined) body.allowFileDiscovery = p.allowFileDiscovery;
      const qs: Record<string, unknown> = { supportsAllDrives: true };
      if (p.emailMessage) qs.emailMessage = p.emailMessage;
      if (p.sendNotificationEmail !== undefined)
        qs.sendNotificationEmail = p.sendNotificationEmail;
      if (p.transferOwnership !== undefined) qs.transferOwnership = p.transferOwnership;
      if (p.moveToNewOwnersRoot !== undefined) qs.moveToNewOwnersRoot = p.moveToNewOwnersRoot;
      if (p.useDomainAdminAccess !== undefined) qs.useDomainAdminAccess = p.useDomainAdminAccess;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/permissions`,
        body,
        qs,
      );
    },
  });

  rl.registerAction("file.listPermissions", {
    description: "List permissions on a file",
    inputSchema: {
      fileId: { type: "string", required: true },
      useDomainAdminAccess: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${p.fileId}/permissions`,
        undefined,
        {
          supportsAllDrives: true,
          useDomainAdminAccess: p.useDomainAdminAccess,
          fields: "*",
        },
      );
    },
  });

  rl.registerAction("file.deletePermission", {
    description: "Revoke a permission on a file",
    inputSchema: {
      fileId: { type: "string", required: true },
      permissionId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(
        ctx,
        "DELETE",
        `/drive/v3/files/${p.fileId}/permissions/${p.permissionId}`,
        undefined,
        { supportsAllDrives: true },
      );
      return { success: true };
    },
  });

  // ── Folder ────────────────────────────────────────────

  rl.registerAction("folder.create", {
    description: "Create a folder",
    inputSchema: {
      name: { type: "string", required: false, description: 'Default: "Untitled"' },
      folderId: { type: "string", required: false, description: "Parent folder" },
      driveId: { type: "string", required: false },
      folderColorRgb: { type: "string", required: false, description: "Hex RGB" },
      fields: { type: "string", required: false, description: "Fields projection" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: (p.name as string) || "Untitled",
        mimeType: DRIVE.FOLDER,
        parents: [resolveParent(p.folderId as string, p.driveId as string)],
      };
      if (p.folderColorRgb) body.folderColorRgb = p.folderColorRgb;
      const qs: Record<string, unknown> = {
        supportsAllDrives: true,
        fields: p.fields ?? "*",
      };
      return driveRequest(ctx, "POST", "/drive/v3/files", body, qs);
    },
  });

  rl.registerAction("folder.delete", {
    description:
      "Delete a folder. Moves to trash by default; pass deletePermanently=true to erase.",
    inputSchema: {
      folderId: { type: "string", required: true },
      deletePermanently: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.deletePermanently) {
        await driveRequest(ctx, "DELETE", `/drive/v3/files/${p.folderId}`, undefined, {
          supportsAllDrives: true,
        });
      } else {
        await driveRequest(
          ctx,
          "PATCH",
          `/drive/v3/files/${p.folderId}`,
          { trashed: true },
          { supportsAllDrives: true },
        );
      }
      return { id: p.folderId, success: true };
    },
  });

  rl.registerAction("folder.share", {
    description: "Add a permission to a folder (same shape as file.share)",
    inputSchema: {
      folderId: { type: "string", required: true },
      role: { type: "string", required: true },
      type: { type: "string", required: true },
      emailAddress: { type: "string", required: false },
      domain: { type: "string", required: false },
      allowFileDiscovery: { type: "boolean", required: false },
      emailMessage: { type: "string", required: false },
      sendNotificationEmail: { type: "boolean", required: false },
      transferOwnership: { type: "boolean", required: false },
      moveToNewOwnersRoot: { type: "boolean", required: false },
      useDomainAdminAccess: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown> & { folderId: string };
      const body: Record<string, unknown> = { role: p.role, type: p.type };
      if (p.emailAddress) body.emailAddress = p.emailAddress;
      if (p.domain) body.domain = p.domain;
      if (p.allowFileDiscovery !== undefined) body.allowFileDiscovery = p.allowFileDiscovery;
      const qs: Record<string, unknown> = { supportsAllDrives: true };
      for (const k of [
        "emailMessage",
        "sendNotificationEmail",
        "transferOwnership",
        "moveToNewOwnersRoot",
        "useDomainAdminAccess",
      ] as const) {
        if (p[k] !== undefined) qs[k] = p[k];
      }
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.folderId}/permissions`,
        body,
        qs,
      );
    },
  });

  // ── File / folder search ──────────────────────────────

  rl.registerAction("fileFolder.search", {
    description:
      "Search files and folders. `query` is passed directly; `name` wraps it as `name contains '…'`. Combine with folderId/driveId/whatToSearch/fileTypes filters.",
    inputSchema: {
      name: {
        type: "string",
        required: false,
        description: "Convenience: matches `name contains '<value>'`",
      },
      query: {
        type: "string",
        required: false,
        description: "Raw Drive search query; takes precedence over `name`",
      },
      folderId: { type: "string", required: false },
      driveId: { type: "string", required: false },
      whatToSearch: {
        type: "string",
        required: false,
        description: "all (default) | files | folders",
      },
      fileTypes: {
        type: "array",
        required: false,
        description: "MIME type filter (ignored when whatToSearch=folders)",
      },
      includeTrashed: { type: "boolean", required: false },
      fields: {
        type: "array",
        required: false,
        description: "Per-file fields to return (default: id,name)",
      },
      returnAll: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const clauses: string[] = [];
      if (typeof p.query === "string" && p.query.length > 0) {
        clauses.push(p.query);
      } else if (typeof p.name === "string" && p.name.length > 0) {
        // Drive expects single-quoted strings with \' escaping.
        const escaped = p.name.replace(/'/g, "\\'");
        clauses.push(`name contains '${escaped}'`);
      }
      if (typeof p.folderId === "string" && p.folderId && p.folderId !== "root") {
        clauses.push(`'${p.folderId}' in parents`);
      }
      const whatToSearch = (p.whatToSearch as string | undefined) ?? "all";
      if (whatToSearch === "folders") {
        clauses.push(`mimeType = '${DRIVE.FOLDER}'`);
      } else {
        if (whatToSearch === "files") {
          clauses.push(`mimeType != '${DRIVE.FOLDER}'`);
        }
        const types = toStringArray(p.fileTypes);
        if (types && !types.includes("*")) {
          const typeClause = types.map((t) => `mimeType = '${t}'`).join(" or ");
          if (typeClause) clauses.push(`(${typeClause})`);
        }
      }
      if (!p.includeTrashed) clauses.push("trashed = false");

      const fieldsArr = toStringArray(p.fields);
      const perFileFields =
        fieldsArr && fieldsArr.length > 0
          ? fieldsArr.includes("*")
            ? "*"
            : fieldsArr.join(", ")
          : "id, name";
      const qs: Record<string, unknown> = {
        q: clauses.join(" and "),
        fields: `nextPageToken, files(${perFileFields})`,
      };
      applyDriveScopes(qs, p.driveId as string | undefined);
      if (p.pageToken) qs.pageToken = p.pageToken;

      if (p.returnAll) return paginateAll(ctx, "/drive/v3/files", "files", qs);
      if (p.maxResults) qs.pageSize = p.maxResults;
      const res = (await driveRequest(ctx, "GET", "/drive/v3/files", undefined, qs)) as {
        files?: unknown[];
      };
      return res.files ?? [];
    },
  });

  // ── Shared drive ──────────────────────────────────────

  rl.registerAction("drive.create", {
    description: "Create a shared drive. requestId is generated automatically.",
    inputSchema: {
      name: { type: "string", required: true },
      colorRgb: { type: "string", required: false },
      hidden: { type: "boolean", required: false },
      capabilities: { type: "object", required: false },
      restrictions: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      for (const k of ["colorRgb", "hidden", "capabilities", "restrictions"] as const) {
        if (p[k] !== undefined) body[k] = p[k];
      }
      return driveRequest(ctx, "POST", "/drive/v3/drives", body, { requestId: uuid() });
    },
  });

  rl.registerAction("drive.get", {
    description: "Get a shared drive",
    inputSchema: {
      driveId: { type: "string", required: true },
      useDomainAdminAccess: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.useDomainAdminAccess !== undefined) qs.useDomainAdminAccess = p.useDomainAdminAccess;
      return driveRequest(ctx, "GET", `/drive/v3/drives/${p.driveId}`, undefined, qs);
    },
  });

  rl.registerAction("drive.list", {
    description: "List shared drives",
    inputSchema: {
      q: { type: "string", required: false, description: "Shared-drive search syntax" },
      useDomainAdminAccess: { type: "boolean", required: false },
      returnAll: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.q) qs.q = p.q;
      if (p.useDomainAdminAccess !== undefined) qs.useDomainAdminAccess = p.useDomainAdminAccess;
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.returnAll) return paginateAll(ctx, "/drive/v3/drives", "drives", qs);
      if (p.maxResults) qs.pageSize = p.maxResults;
      const res = (await driveRequest(ctx, "GET", "/drive/v3/drives", undefined, qs)) as {
        drives?: unknown[];
      };
      return res.drives ?? [];
    },
  });

  rl.registerAction("drive.update", {
    description: "Patch a shared drive",
    inputSchema: {
      driveId: { type: "string", required: true },
      name: { type: "string", required: false },
      colorRgb: { type: "string", required: false },
      restrictions: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const k of ["name", "colorRgb", "restrictions"] as const) {
        if (p[k] !== undefined) body[k] = p[k];
      }
      return driveRequest(ctx, "PATCH", `/drive/v3/drives/${p.driveId}`, body);
    },
  });

  rl.registerAction("drive.delete", {
    description: "Delete a shared drive",
    inputSchema: { driveId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(ctx, "DELETE", `/drive/v3/drives/${p.driveId}`);
      return { success: true };
    },
  });

  // ─── Comments ────────────────────────────────────────────────────
  //
  // Drive's `comments` and `replies` resources. The comments live on
  // the Drive side for both Google-native docs and Office files, and
  // are distinct from in-document comments stored inside .docx /
  // .xlsx / .pptx bytes (those round-trip through `revisions`).

  const COMMENT_FIELDS =
    "kind,id,createdTime,modifiedTime,resolved,deleted," +
    "author(displayName,emailAddress)," +
    "quotedFileContent(value,mimeType)," +
    "anchor,content,htmlContent," +
    "replies(kind,id,createdTime,modifiedTime,deleted,author(displayName,emailAddress),action,content,htmlContent)";
  const COMMENT_LIST_FIELDS = `kind,nextPageToken,comments(${COMMENT_FIELDS})`;
  const REPLY_FIELDS =
    "kind,id,createdTime,modifiedTime,deleted," +
    "author(displayName,emailAddress),action,content,htmlContent";
  const REPLY_LIST_FIELDS = `kind,nextPageToken,replies(${REPLY_FIELDS})`;

  rl.registerAction("comment.list", {
    description:
      "List all comments on a Drive file, including each comment's replies. Returns an array sorted by Drive's default (most recent first).",
    inputSchema: {
      fileId: { type: "string", required: true },
      includeDeleted: {
        type: "boolean",
        required: false,
        description: "Include deleted comments. Default false.",
      },
      pageSize: {
        type: "number",
        required: false,
        description: "Max comments per page (Drive caps at 100).",
      },
      startModifiedTime: {
        type: "string",
        required: false,
        description:
          "RFC 3339 timestamp; only return comments modified at or after this time.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const out: unknown[] = [];
      const query: Record<string, unknown> = {
        fields: COMMENT_LIST_FIELDS,
        includeDeleted: p.includeDeleted ?? false,
        pageSize: p.pageSize ?? 100,
        startModifiedTime: p.startModifiedTime,
      };
      let pageToken: string | undefined;
      do {
        if (pageToken) query.pageToken = pageToken;
        const page = (await driveRequest(
          ctx,
          "GET",
          `/drive/v3/files/${fileId}/comments`,
          undefined,
          query,
        )) as { comments?: unknown[]; nextPageToken?: string };
        if (Array.isArray(page.comments)) out.push(...page.comments);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { fileId, count: out.length, comments: out };
    },
  });

  rl.registerAction("comment.get", {
    description: "Fetch a single comment (with its replies) by ID.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      includeDeleted: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}`,
        undefined,
        { fields: COMMENT_FIELDS, includeDeleted: p.includeDeleted ?? false },
      );
    },
  });

  rl.registerAction("comment.create", {
    description:
      "Create a new top-level comment on a file. Pass quotedFileContent.value (and optionally mimeType) to anchor the comment to a specific snippet.",
    inputSchema: {
      fileId: { type: "string", required: true },
      content: { type: "string", required: true, description: "Comment body (plain text)." },
      quotedFileContent: {
        type: "object",
        required: false,
        description: "{ value: string, mimeType?: string }",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { content: p.content };
      if (p.quotedFileContent) body.quotedFileContent = p.quotedFileContent;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/comments`,
        body,
        { fields: COMMENT_FIELDS },
      );
    },
  });

  rl.registerAction("comment.update", {
    description:
      "Edit the content of an existing comment. Caller must be the author or have edit rights.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "PATCH",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}`,
        { content: p.content },
        { fields: COMMENT_FIELDS },
      );
    },
  });

  rl.registerAction("comment.delete", {
    description: "Soft-delete a comment.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(
        ctx,
        "DELETE",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("comment.resolve", {
    description:
      "Resolve a comment thread by posting a resolution reply. `resolved` on a Comment is computed from replies; this is the canonical way to mark a thread done.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      content: {
        type: "string",
        required: false,
        description: "Optional reply body. Defaults to 'Resolved.'",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies`,
        { action: "resolve", content: (p.content as string) ?? "Resolved." },
        { fields: REPLY_FIELDS },
      );
    },
  });

  rl.registerAction("comment.reopen", {
    description: "Re-open a previously resolved comment by posting a reopen reply.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      content: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies`,
        { action: "reopen", content: (p.content as string) ?? "Reopened." },
        { fields: REPLY_FIELDS },
      );
    },
  });

  rl.registerAction("reply.list", {
    description: "List replies on a specific comment.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      includeDeleted: { type: "boolean", required: false },
      pageSize: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const out: unknown[] = [];
      const query: Record<string, unknown> = {
        fields: REPLY_LIST_FIELDS,
        includeDeleted: p.includeDeleted ?? false,
        pageSize: p.pageSize ?? 100,
      };
      let pageToken: string | undefined;
      do {
        if (pageToken) query.pageToken = pageToken;
        const page = (await driveRequest(
          ctx,
          "GET",
          `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies`,
          undefined,
          query,
        )) as { replies?: unknown[]; nextPageToken?: string };
        if (Array.isArray(page.replies)) out.push(...page.replies);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { fileId: p.fileId, commentId: p.commentId, count: out.length, replies: out };
    },
  });

  rl.registerAction("reply.create", {
    description:
      "Post a reply to a comment. Pass action: 'resolve' | 'reopen' to also flip the comment state.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      content: { type: "string", required: true },
      action: {
        type: "string",
        required: false,
        description: "'resolve' | 'reopen'. Omit for a plain reply.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { content: p.content };
      if (p.action === "resolve" || p.action === "reopen") body.action = p.action;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies`,
        body,
        { fields: REPLY_FIELDS },
      );
    },
  });

  rl.registerAction("reply.update", {
    description: "Edit the content of a reply.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      replyId: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "PATCH",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies/${p.replyId}`,
        { content: p.content },
        { fields: REPLY_FIELDS },
      );
    },
  });

  rl.registerAction("reply.delete", {
    description: "Soft-delete a reply.",
    inputSchema: {
      fileId: { type: "string", required: true },
      commentId: { type: "string", required: true },
      replyId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(
        ctx,
        "DELETE",
        `/drive/v3/files/${p.fileId}/comments/${p.commentId}/replies/${p.replyId}`,
      );
      return { success: true };
    },
  });

  // ─── Revisions ──────────────────────────────────────────────────
  //
  // Drive retains prior bytes of every file. For Google-native docs
  // that means snapshots of the doc state; for Office files (.docx,
  // .xlsx, .pptx) it means the actual byte history. Exposing this
  // matters because in-document review comments on Office files live
  // *inside* the file bytes (`word/comments.xml`), not in Drive's
  // `comments` resource. A call to `file.update({ contentPath })`
  // silently destroys those comments; the only programmatic recovery
  // path is reading prior revision bytes through these actions.
  //
  // Default retention is ~30 days / 100 revisions for Office files;
  // set `keepForever: true` via `revision.update` on a known-good
  // revision before any risky in-place update.

  const REVISION_FIELDS =
    "id,mimeType,modifiedTime,keepForever,originalFilename,size,md5Checksum," +
    "lastModifyingUser(displayName,emailAddress)," +
    "published,publishAuto,publishedOutsideDomain,publishedLink";
  const REVISION_LIST_FIELDS = `kind,nextPageToken,revisions(${REVISION_FIELDS})`;

  rl.registerAction("revision.list", {
    description:
      "List every revision Drive retains for a file, oldest first. For Office files the per-revision bytes are what `revision.download` returns.",
    inputSchema: {
      fileId: { type: "string", required: true },
      pageSize: { type: "number", required: false, description: "Default 200; Drive caps at 1000." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const out: unknown[] = [];
      const query: Record<string, unknown> = {
        fields: REVISION_LIST_FIELDS,
        pageSize: p.pageSize ?? 200,
      };
      let pageToken: string | undefined;
      do {
        if (pageToken) query.pageToken = pageToken;
        const page = (await driveRequest(
          ctx,
          "GET",
          `/drive/v3/files/${fileId}/revisions`,
          undefined,
          query,
        )) as { revisions?: unknown[]; nextPageToken?: string };
        if (Array.isArray(page.revisions)) out.push(...page.revisions);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { fileId, count: out.length, revisions: out };
    },
  });

  rl.registerAction("revision.get", {
    description: "Fetch metadata for a single revision.",
    inputSchema: {
      fileId: { type: "string", required: true },
      revisionId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(
        ctx,
        "GET",
        `/drive/v3/files/${p.fileId}/revisions/${p.revisionId}`,
        undefined,
        { fields: REVISION_FIELDS },
      );
    },
  });

  rl.registerAction("revision.download", {
    description:
      "Download the bytes of a specific revision. Pass savePath to write to disk and get back the path; otherwise returns { contentBase64, mimeType, size }. This is the recovery path when an in-place file.update has overwritten in-document comments on an Office file.",
    inputSchema: {
      fileId: { type: "string", required: true },
      revisionId: { type: "string", required: true },
      savePath: {
        type: "string",
        required: false,
        description: "Filesystem path to write the bytes to. If omitted, returns base64.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const revisionId = p.revisionId as string;
      const token = await accessToken(ctx);
      const url = new URL(`${API_BASE}/drive/v3/files/${fileId}/revisions/${revisionId}`);
      url.searchParams.set("alt", "media");
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `googleDrive: revision download failed (${res.status}): ${await res.text()}`,
        );
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
      if (typeof p.savePath === "string") {
        writeFileSync(p.savePath, bytes);
        return { fileId, revisionId, mimeType, size: bytes.byteLength, savedTo: p.savePath };
      }
      return {
        fileId,
        revisionId,
        mimeType,
        size: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      };
    },
  });

  rl.registerAction("revision.update", {
    description:
      "Patch revision metadata. The most useful flag is keepForever — without it Drive can garbage-collect revisions after 30 days / 100 versions on Office files. Set keepForever=true on the head revision before any risky file.update so prior bytes are guaranteed recoverable.",
    inputSchema: {
      fileId: { type: "string", required: true },
      revisionId: { type: "string", required: true },
      keepForever: { type: "boolean", required: false },
      published: { type: "boolean", required: false },
      publishAuto: { type: "boolean", required: false },
      publishedOutsideDomain: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const k of [
        "keepForever",
        "published",
        "publishAuto",
        "publishedOutsideDomain",
      ] as const) {
        if (p[k] !== undefined) body[k] = p[k];
      }
      if (Object.keys(body).length === 0) {
        throw new Error(
          "googleDrive.revision.update: pass at least one of keepForever / published / publishAuto / publishedOutsideDomain.",
        );
      }
      return driveRequest(
        ctx,
        "PATCH",
        `/drive/v3/files/${p.fileId}/revisions/${p.revisionId}`,
        body,
        { fields: REVISION_FIELDS },
      );
    },
  });

  rl.registerAction("revision.delete", {
    description: "Permanently delete a revision (head revision cannot be deleted).",
    inputSchema: {
      fileId: { type: "string", required: true },
      revisionId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(
        ctx,
        "DELETE",
        `/drive/v3/files/${p.fileId}/revisions/${p.revisionId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("revision.restore", {
    description:
      "Restore an older revision as the head of the file. Downloads the revision bytes and re-uploads them via multipart so the head moves to that content. Drive's REST API has no native restore endpoint for binary files; this performs the equivalent in two calls. Returns the new head file resource.",
    inputSchema: {
      fileId: { type: "string", required: true },
      revisionId: { type: "string", required: true, description: "Revision to restore as head." },
      mimeType: {
        type: "string",
        required: false,
        description: "Override mime type for the re-upload. Defaults to the revision's mime type.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const fileId = p.fileId as string;
      const revisionId = p.revisionId as string;
      const token = await accessToken(ctx);

      // 1. Pull the chosen revision's bytes.
      const dl = await fetch(
        `${API_BASE}/drive/v3/files/${fileId}/revisions/${revisionId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dl.ok) {
        throw new Error(
          `googleDrive: revision restore download failed (${dl.status}): ${await dl.text()}`,
        );
      }
      const bytes = Buffer.from(await dl.arrayBuffer());
      const mime =
        (p.mimeType as string | undefined) ??
        dl.headers.get("content-type") ??
        "application/octet-stream";

      // 2. Multipart-PATCH them as the new head of the same file.
      const url = new URL(`${API_BASE}/upload/drive/v3/files/${fileId}`);
      url.searchParams.set("uploadType", "multipart");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set(
        "fields",
        "id,name,mimeType,modifiedTime,size,headRevisionId,webViewLink",
      );
      const body = buildMultipart({ mimeType: mime }, bytes, mime);
      const res = await fetch(url.toString(), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
          "Content-Length": String(body.byteLength),
        },
        body: new Uint8Array(body),
      });
      if (!res.ok) {
        throw new Error(
          `googleDrive: revision restore upload failed (${res.status}): ${await res.text()}`,
        );
      }
      const head = (await res.json()) as Record<string, unknown>;
      return { fileId, restoredFromRevisionId: revisionId, head };
    },
  });

  // ─── Changes feed ───────────────────────────────────────────────
  //
  // Drive's change feed. Without these the agent has to poll comment.list
  // per file. With them, a sensor can wake on any file change in the user's
  // corpus or in a specific shared drive.

  rl.registerAction("changes.getStartPageToken", {
    description:
      "Get the current Drive change-feed start page token. Use as the seed `pageToken` for the first `changes.list` call.",
    inputSchema: {
      driveId: { type: "string", required: false, description: "Shared-drive id; omit for the user's My Drive corpus." },
      supportsAllDrives: { type: "boolean", required: false, default: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(ctx, "GET", `/drive/v3/changes/startPageToken`, undefined, {
        driveId: p.driveId,
        supportsAllDrives: p.supportsAllDrives ?? true,
      });
    },
  });

  rl.registerAction("changes.list", {
    description:
      "List changes to files and Shared Drives since the given `pageToken`. Returns `{ changes, newStartPageToken, nextPageToken? }`. Drive does not surface comment-level changes here — use this for file metadata/content changes; pair with comments.list for review activity.",
    inputSchema: {
      pageToken: { type: "string", required: true, description: "Token from `changes.getStartPageToken` or a prior `nextPageToken`." },
      driveId: { type: "string", required: false },
      spaces: { type: "string", required: false, description: "drive | photos | appDataFolder. Default drive." },
      includeRemoved: { type: "boolean", required: false },
      includeItemsFromAllDrives: { type: "boolean", required: false, default: true },
      supportsAllDrives: { type: "boolean", required: false, default: true },
      restrictToMyDrive: { type: "boolean", required: false },
      pageSize: { type: "number", required: false },
      fields: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(ctx, "GET", `/drive/v3/changes`, undefined, {
        pageToken: p.pageToken,
        driveId: p.driveId,
        spaces: p.spaces,
        includeRemoved: p.includeRemoved,
        includeItemsFromAllDrives: p.includeItemsFromAllDrives ?? true,
        supportsAllDrives: p.supportsAllDrives ?? true,
        restrictToMyDrive: p.restrictToMyDrive,
        pageSize: p.pageSize ?? 100,
        fields:
          (p.fields as string | undefined) ??
          "kind,nextPageToken,newStartPageToken,changes(kind,removed,fileId,driveId,changeType,time,file(id,name,mimeType,modifiedTime,trashed,parents))",
      });
    },
  });

  rl.registerAction("changes.watch", {
    description:
      "Subscribe to push notifications on the change feed. Drive will POST to `address` whenever a change in this corpus is recorded. Returns a channel resource; pair with `channels.stop` (`changes.stop`) when done.",
    inputSchema: {
      pageToken: { type: "string", required: true },
      address: { type: "string", required: true, description: "HTTPS URL Drive will POST notifications to." },
      channelId: { type: "string", required: false, description: "Caller-chosen UUID. Auto-generated when omitted." },
      token: { type: "string", required: false, description: "Optional opaque token Drive echoes on each delivery." },
      expiration: { type: "number", required: false, description: "Unix ms at which Drive should expire the channel. Defaults ~1 hour." },
      driveId: { type: "string", required: false },
      supportsAllDrives: { type: "boolean", required: false, default: true },
      includeItemsFromAllDrives: { type: "boolean", required: false, default: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        id: (p.channelId as string | undefined) ?? uuid(),
        type: "web_hook",
        address: p.address,
      };
      if (p.token) body.token = p.token;
      if (p.expiration) body.expiration = String(p.expiration);
      return driveRequest(ctx, "POST", `/drive/v3/changes/watch`, body, {
        pageToken: p.pageToken,
        driveId: p.driveId,
        supportsAllDrives: p.supportsAllDrives ?? true,
        includeItemsFromAllDrives: p.includeItemsFromAllDrives ?? true,
      });
    },
  });

  rl.registerAction("changes.stop", {
    description: "Stop a previously-subscribed change channel. Pass the same `channelId` and `resourceId` returned by `changes.watch`.",
    inputSchema: {
      channelId: { type: "string", required: true },
      resourceId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await driveRequest(ctx, "POST", `/drive/v3/channels/stop`, { id: p.channelId, resourceId: p.resourceId });
      return { success: true };
    },
  });

  // ─── Permission update ──────────────────────────────────────────
  //
  // Patch an existing permission. The bundled `file.share` creates a new
  // permission, and `file.deletePermission` removes one — but to promote a
  // commenter to writer (or expire a permission) without re-sharing, you
  // need the PATCH endpoint.

  rl.registerAction("permission.update", {
    description:
      "Patch an existing file/folder permission. Use to change the role on an existing share, set an expiration time, or transfer ownership.",
    inputSchema: {
      fileId: { type: "string", required: true },
      permissionId: { type: "string", required: true },
      role: { type: "string", required: false, description: "owner | organizer | fileOrganizer | writer | commenter | reader" },
      expirationTime: { type: "string", required: false, description: "RFC 3339; only valid for writer/commenter/reader on My Drive files." },
      transferOwnership: { type: "boolean", required: false },
      removeExpiration: { type: "boolean", required: false },
      useDomainAdminAccess: { type: "boolean", required: false },
      supportsAllDrives: { type: "boolean", required: false, default: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.role) body.role = p.role;
      if (p.expirationTime) body.expirationTime = p.expirationTime;
      const qs: Record<string, unknown> = { supportsAllDrives: p.supportsAllDrives ?? true };
      if (p.transferOwnership) qs.transferOwnership = true;
      if (p.removeExpiration) qs.removeExpiration = true;
      if (p.useDomainAdminAccess) qs.useDomainAdminAccess = true;
      if (Object.keys(body).length === 0 && !qs.removeExpiration) {
        throw new Error("googleDrive.permission.update: pass at least one of role / expirationTime / removeExpiration.");
      }
      return driveRequest(ctx, "PATCH", `/drive/v3/files/${p.fileId}/permissions/${p.permissionId}`, body, qs);
    },
  });

  // ─── Access proposals ───────────────────────────────────────────
  //
  // Drive's "Request access" flow. When a user clicks "Request access" on a
  // file they can't open, Drive records an access proposal which the file's
  // owner can resolve (accept and grant, or deny). These actions let the
  // agent triage and resolve those requests programmatically.

  rl.registerAction("accessProposal.list", {
    description: "List access proposals (Request-access entries) on a file.",
    inputSchema: {
      fileId: { type: "string", required: true },
      pageSize: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const out: unknown[] = [];
      let pageToken: string | undefined;
      do {
        const page = (await driveRequest(
          ctx,
          "GET",
          `/drive/v3/files/${p.fileId}/accessproposals`,
          undefined,
          { pageSize: p.pageSize ?? 100, pageToken },
        )) as { accessProposals?: unknown[]; nextPageToken?: string };
        if (Array.isArray(page.accessProposals)) out.push(...page.accessProposals);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { fileId: p.fileId, count: out.length, accessProposals: out };
    },
  });

  rl.registerAction("accessProposal.resolve", {
    description:
      "Resolve an access proposal. `action` is one of 'ACCEPT' or 'DENY'. When accepting, pass `role` (default 'reader') to grant.",
    inputSchema: {
      fileId: { type: "string", required: true },
      proposalId: { type: "string", required: true },
      action: { type: "string", required: true, description: "'ACCEPT' | 'DENY'" },
      role: { type: "string", required: false, description: "Role to grant on ACCEPT. Default 'reader'." },
      view: { type: "string", required: false, description: "Optional Drive scope view (e.g. 'published')." },
      sendNotification: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { action: p.action };
      if (p.action === "ACCEPT") {
        body.role = [(p.role as string | undefined) ?? "reader"];
        if (p.view) body.view = p.view;
      }
      if (p.sendNotification !== undefined) body.sendNotification = p.sendNotification;
      return driveRequest(
        ctx,
        "POST",
        `/drive/v3/files/${p.fileId}/accessproposals/${p.proposalId}:resolve`,
        body,
      );
    },
  });

  // ─── About ───────────────────────────────────────────────────────

  rl.registerAction("about.get", {
    description:
      "Current user info: storage quota, export formats, max upload size, importable mime types. Useful for healthchecks and conversion planning.",
    inputSchema: {
      fields: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return driveRequest(ctx, "GET", `/drive/v3/about`, undefined, {
        fields:
          (p.fields as string | undefined) ??
          "user(displayName,emailAddress,permissionId,photoLink),storageQuota,maxUploadSize,canCreateDrives,exportFormats,importFormats",
      });
    },
  });

  // ─── File export (ergonomic wrapper) ────────────────────────────

  rl.registerAction("file.export", {
    description:
      "Export a Google-native file (Doc/Sheet/Slide/Drawing/Form) to a non-native mimeType. Wrapper around the export endpoint; pass `savePath` to write to disk and get the path back, otherwise returns base64.",
    inputSchema: {
      fileId: { type: "string", required: true },
      mimeType: {
        type: "string",
        required: true,
        description:
          "Target export mime, e.g. application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/pdf, text/plain, text/csv.",
      },
      savePath: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const token = await accessToken(ctx);
      const u = new URL(`${API_BASE}/drive/v3/files/${p.fileId}/export`);
      u.searchParams.set("mimeType", p.mimeType as string);
      const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        throw new Error(`googleDrive: export failed (${res.status}): ${await res.text()}`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? (p.mimeType as string);
      if (typeof p.savePath === "string") {
        writeFileSync(p.savePath, bytes);
        return { path: p.savePath, mimeType: contentType, size: bytes.byteLength };
      }
      return { mimeType: contentType, size: bytes.byteLength, contentBase64: bytes.toString("base64") };
    },
  });

  // ─── Raw file.list ──────────────────────────────────────────────

  rl.registerAction("file.list", {
    description:
      "Raw Drive `files.list`. Pass Drive search-syntax `q` and any combination of corpora / driveId / spaces / orderBy. `fileFolder.search` is the friendlier wrapper; reach for `file.list` only when you need the unwrapped surface.",
    inputSchema: {
      q: { type: "string", required: false },
      corpora: { type: "string", required: false, description: "user | drive | allDrives" },
      driveId: { type: "string", required: false },
      spaces: { type: "string", required: false },
      orderBy: { type: "string", required: false },
      pageSize: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      includeItemsFromAllDrives: { type: "boolean", required: false, default: true },
      supportsAllDrives: { type: "boolean", required: false, default: true },
      fields: { type: "string", required: false },
      returnAll: { type: "boolean", required: false, description: "If true, follows pageToken until exhausted and returns the concatenated file list." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const baseQs: Record<string, unknown> = {
        q: p.q,
        corpora: p.corpora,
        driveId: p.driveId,
        spaces: p.spaces,
        orderBy: p.orderBy,
        pageSize: p.pageSize ?? 100,
        includeItemsFromAllDrives: p.includeItemsFromAllDrives ?? true,
        supportsAllDrives: p.supportsAllDrives ?? true,
        fields: (p.fields as string | undefined) ?? "kind,nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,owners(emailAddress),driveId,webViewLink)",
      };
      if (p.returnAll) {
        return paginateAll(ctx, "/drive/v3/files", "files", baseQs);
      }
      return driveRequest(ctx, "GET", `/drive/v3/files`, undefined, { ...baseQs, pageToken: p.pageToken });
    },
  });
}
