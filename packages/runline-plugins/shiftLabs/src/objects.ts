import { openAsBlob } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  organizationId,
  pathSegment,
  request,
} from "./shared.js";

const OBJECTS_BASE = "/v1/services/objects";

export const OBJECT_STATUS = ["pending_upload", "ready", "archived"] as const;
export const OBJECT_LINK_TARGET = [
  "session",
  "artifact",
  "eval_case",
  "db_record",
] as const;

/** Mirrors the public service contract's 5 GiB object ceiling. */
const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
const STRICT_OBJECT = { additionalProperties: false } as const;
const Id = t.String({ minLength: 1, pattern: "\\S" });

const MEDIA_TYPES: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  wav: "audio/wav",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

interface StoredObject {
  id: string;
  status: (typeof OBJECT_STATUS)[number];
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  [key: string]: unknown;
}

function mediaTypeFor(path: string, override?: string): string {
  if (override) return override;
  return (
    MEDIA_TYPES[extname(path).slice(1).toLowerCase()] ??
    "application/octet-stream"
  );
}

async function fileBody(
  path: string,
  sizeBytes: number,
): Promise<Blob | Buffer> {
  try {
    return await openAsBlob(path);
  } catch {
    // Runtimes without fs.openAsBlob fall back to buffering; refuse to
    // buffer files that would strain the host process.
    if (sizeBytes > 512 * 1024 * 1024) {
      throw new Error(
        "This runtime cannot stream uploads and the file is too large to buffer.",
      );
    }
    return await readFile(path);
  }
}

function linkSchema() {
  return t.Object(
    {
      targetType: enumSchema("Link target type", OBJECT_LINK_TARGET),
      targetId: t.String({
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
        description:
          "Target ID; db_record targets use source_system/table/row style ids, e.g. R2M_Sys/GoodsReceiptLog/42",
      }),
      role: t.Optional(
        t.String({
          minLength: 1,
          maxLength: 200,
          pattern: "\\S",
          description: "Link role, e.g. source",
        }),
      ),
    },
    STRICT_OBJECT,
  );
}

const provenanceFields = {
  workspaceId: t.Optional(Id),
  sessionId: t.Optional(Id),
  artifactId: t.Optional(Id),
};

export function registerObjectActions(rl: RunlinePluginAPI) {
  rl.registerAction("object.upload", {
    access: "write",
    description:
      "Persist a local binary file (image, PDF, document, export) in the " +
      "organization's durable object bucket. Uploads through a short-lived " +
      "signed grant and returns the ready object with its stable ID — use " +
      "that ID as a durable sourceObjectId in DB rows and artifact links.",
    inputSchema: t.Object(
      {
        path: t.String({
          minLength: 1,
          pattern: "\\S",
          description: "Host path of the file to store",
        }),
        contentType: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 200,
            pattern: "\\S",
            description:
              "Explicit MIME type; inferred from the extension when omitted",
          }),
        ),
        filename: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 500,
            pattern: "\\S",
            description: "Original filename; defaults to the path's basename",
          }),
        ),
        metadata: t.Optional(
          t.Record(t.String(), t.Unknown(), {
            description: "Small caller-defined metadata object",
          }),
        ),
        ...provenanceFields,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        path: string;
        contentType?: string;
        filename?: string;
        metadata?: Record<string, unknown>;
        workspaceId?: string;
        sessionId?: string;
        artifactId?: string;
      };
      const org = organizationId(ctx);
      const contentType = mediaTypeFor(fields.path, fields.contentType);
      const file = await stat(fields.path);
      if (!file.isFile()) throw new Error(`${fields.path} is not a file`);
      if (file.size === 0) throw new Error("File is empty");
      if (file.size > MAX_OBJECT_BYTES) {
        throw new Error(
          `File is larger than the ${MAX_OBJECT_BYTES}-byte service limit`,
        );
      }

      const created = await request<{
        object: StoredObject;
        upload: {
          method: "PUT";
          url: string;
          headers: Record<string, string>;
          expiresAt: string;
        };
      }>(ctx, `${OBJECTS_BASE}/objects`, {
        method: "POST",
        body: JSON.stringify({
          organizationId: org,
          contentType,
          sizeBytes: file.size,
          filename: fields.filename ?? basename(fields.path),
          workspaceId: fields.workspaceId,
          sessionId: fields.sessionId,
          artifactId: fields.artifactId,
          metadata: fields.metadata,
        }),
      });

      const uploadHeaders = new Headers(created.upload.headers);
      if (!uploadHeaders.has("content-type")) {
        uploadHeaders.set("content-type", contentType);
      }
      const upload = await fetch(created.upload.url, {
        method: created.upload.method,
        headers: uploadHeaders,
        body: await fileBody(fields.path, file.size),
      });
      if (!upload.ok) {
        throw new Error(`Object upload failed: HTTP ${upload.status}`);
      }

      return request<StoredObject>(
        ctx,
        `${OBJECTS_BASE}/objects/${pathSegment(created.object.id)}/complete`,
        { method: "POST" },
      );
    },
  });

  rl.registerAction("object.list", {
    access: "read",
    description:
      "List stored objects, newest first. Archived objects appear only " +
      "when filtered for by status.",
    inputSchema: t.Object(
      {
        status: t.Optional(enumSchema("Object status", OBJECT_STATUS)),
        contentType: t.Optional(
          t.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
        ),
        ...provenanceFields,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(
        input as Record<string, unknown>,
      )) {
        if (value !== undefined) params.set(key, String(value));
      }
      const query = params.toString();
      const body = await request<{ objects: StoredObject[] }>(
        ctx,
        `${OBJECTS_BASE}/objects${query ? `?${query}` : ""}`,
      );
      return body.objects;
    },
  });

  rl.registerAction("object.get", {
    access: "read",
    description: "Get a stored object's metadata by ID.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request<StoredObject>(
        ctx,
        `${OBJECTS_BASE}/objects/${pathSegment(id)}`,
      );
    },
  });

  rl.registerAction("object.download", {
    access: "read",
    description:
      "Mint a short-lived signed download URL for a ready object. Set " +
      "savePath to also download the bytes to a host file.",
    inputSchema: t.Object(
      {
        id: Id,
        savePath: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description: "Host path to write the downloaded bytes to",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as { id: string; savePath?: string };
      const grant = await request<{
        method: "GET";
        url: string;
        expiresAt: string;
      }>(ctx, `${OBJECTS_BASE}/objects/${pathSegment(fields.id)}/download`, {
        method: "POST",
      });
      if (!fields.savePath) return grant;

      const response = await fetch(grant.url, { method: grant.method });
      if (!response.ok) {
        throw new Error(`Object download failed: HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(fields.savePath, bytes);
      return { savedTo: fields.savePath, sizeBytes: bytes.byteLength };
    },
  });

  rl.registerAction("object.attach", {
    access: "write",
    description:
      "Link an object to what produced or consumed it: a session, " +
      "artifact, eval case, or customer DB record. Links are append-only " +
      "provenance; duplicates are rejected.",
    inputSchema: t.Object(
      {
        id: Id,
        links: t.Array(linkSchema(), { minItems: 1, maxItems: 20 }),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as { id: string; links: unknown[] };
      const body = await request<{ links: unknown[] }>(
        ctx,
        `${OBJECTS_BASE}/objects/${pathSegment(fields.id)}/links`,
        { method: "POST", body: JSON.stringify({ links: fields.links }) },
      );
      return body.links;
    },
  });

  rl.registerAction("object.links", {
    access: "read",
    description: "List an object's provenance links.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ links: unknown[] }>(
        ctx,
        `${OBJECTS_BASE}/objects/${pathSegment(id)}/links`,
      );
      return body.links;
    },
  });

  rl.registerAction("object.archive", {
    access: "write",
    description:
      "Archive a stored object (idempotent). Archived objects drop out of " +
      "default listings and refuse download grants; nothing is deleted.",
    inputSchema: t.Object({ id: Id }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request<StoredObject>(
        ctx,
        `${OBJECTS_BASE}/objects/${pathSegment(id)}/archive`,
        { method: "POST" },
      );
    },
  });

  rl.registerAction("object.bucket", {
    access: "read",
    description:
      "Get the organization's durable object bucket, provisioning it on " +
      "first use.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return request(ctx, `${OBJECTS_BASE}/bucket`);
    },
  });
}
