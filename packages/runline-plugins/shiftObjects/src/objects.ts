import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  listParams,
  pathSegment,
  request,
  withQuery,
} from "../../_shared/shiftCloud.js";
import {
  GENERAL_MEDIA_TYPES,
  mediaTypeFromPath,
  putThroughGrant,
  SIGNED_UPLOAD_MAX_BYTES,
  type SignedUploadGrant,
  statUploadFile,
} from "../../_shared/shiftUpload.js";

const OBJECTS_BASE = "/v1/services/objects";

export const OBJECT_STATUS = ["pending_upload", "ready", "archived"] as const;
export const OBJECT_LINK_TARGET = [
  "session",
  "artifact",
  "eval_case",
  "db_record",
] as const;

const STRICT_OBJECT = { additionalProperties: false } as const;
const Id = t.String({ minLength: 1, pattern: "\\S" });

interface StoredObject {
  id: string;
  status: (typeof OBJECT_STATUS)[number];
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  [key: string]: unknown;
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
      const contentType =
        fields.contentType ??
        mediaTypeFromPath(fields.path, GENERAL_MEDIA_TYPES) ??
        "application/octet-stream";
      const sizeBytes = await statUploadFile(
        fields.path,
        SIGNED_UPLOAD_MAX_BYTES,
      );

      const created = await request<{
        object: StoredObject;
        upload: SignedUploadGrant;
      }>(ctx, `${OBJECTS_BASE}/objects`, {
        method: "POST",
        // The API key is the tenant authority; no organizationId is sent.
        body: JSON.stringify({
          contentType,
          sizeBytes,
          filename: fields.filename ?? basename(fields.path),
          workspaceId: fields.workspaceId,
          sessionId: fields.sessionId,
          artifactId: fields.artifactId,
          metadata: fields.metadata,
        }),
      });

      await putThroughGrant(
        created.upload,
        fields.path,
        contentType,
        sizeBytes,
        "Object upload",
      );

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
      const body = await request<{ objects: StoredObject[] }>(
        ctx,
        withQuery(`${OBJECTS_BASE}/objects`, listParams(input)),
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
