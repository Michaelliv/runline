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
}
