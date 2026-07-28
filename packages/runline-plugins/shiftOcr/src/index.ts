import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { type Ctx, request, STRICT_OBJECT } from "../../_shared/shiftCloud.js";
import {
  putThroughGrant,
  SIGNED_UPLOAD_MAX_BYTES,
  type SignedUploadGrant,
  statUploadFile,
} from "../../_shared/shiftUpload.js";

/**
 * Shift OCR — text and structured-field extraction from images and
 * PDFs through the Shift cloud OCR service. The API key is the tenant
 * authority; no organization ID is ever sent (SHFT-852).
 *
 * Local files route by size: small ones inline as base64 data URLs
 * (one round-trip); larger ones ride the signed-grant arc into the
 * organization's durable object bucket and extract by objectId
 * (SHFT-924), so bytes go to S3, never through the API.
 */

const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
};

/**
 * Raw-file ceiling for inlining as a base64 data URL. Base64 inflates
 * by 4/3, so 20 MiB raw stays well inside provider request limits;
 * anything larger uploads to the object bucket instead.
 */
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

interface OcrDocumentRef {
  type: "image" | "document";
  url: string;
  name?: string;
}

interface OcrObjectRef {
  type: "object";
  objectId: string;
}

async function documentFromPath(
  ctx: Ctx,
  path: string,
): Promise<OcrDocumentRef | OcrObjectRef> {
  const extension = extname(path).slice(1).toLowerCase();
  const imageType = IMAGE_TYPES[extension];
  const documentType = DOCUMENT_TYPES[extension];
  if (!imageType && !documentType) {
    throw new Error(
      `Unsupported file extension for ${path}. Supported: ${[
        ...Object.keys(IMAGE_TYPES),
        ...Object.keys(DOCUMENT_TYPES),
      ].join(", ")}`,
    );
  }
  const mediaType = (imageType ?? documentType) as string;
  const sizeBytes = await statUploadFile(path, SIGNED_UPLOAD_MAX_BYTES);

  if (sizeBytes <= MAX_INLINE_BYTES) {
    const url = `data:${mediaType};base64,${(await readFile(path)).toString("base64")}`;
    return imageType
      ? { type: "image", url }
      : { type: "document", url, name: basename(path) };
  }

  // Large file: into the durable bucket through a signed grant, then
  // extract by reference — the object persists as provenance.
  const created = await request<{
    object: { id: string };
    upload: SignedUploadGrant;
  }>(ctx, "/v1/services/objects/objects", {
    method: "POST",
    body: JSON.stringify({
      contentType: mediaType,
      sizeBytes,
      filename: basename(path),
    }),
  });
  await putThroughGrant(created.upload, path, mediaType, sizeBytes);
  await request(
    ctx,
    `/v1/services/objects/objects/${created.object.id}/complete`,
    { method: "POST" },
  );
  return { type: "object", objectId: created.object.id };
}

function documentFromUrl(
  url: string,
  kind: "image" | "document" | undefined,
): OcrDocumentRef {
  if (kind) return { type: kind, url };
  // Data URLs carry their media type, not an extension.
  if (url.startsWith("data:")) {
    return url.startsWith("data:application/pdf")
      ? { type: "document", url }
      : { type: "image", url };
  }
  const extension = new URL(url).pathname.replace(/.*\./, "").toLowerCase();
  return DOCUMENT_TYPES[extension]
    ? { type: "document", url }
    : { type: "image", url };
}

export default function shiftOcr(rl: RunlinePluginAPI) {
  rl.setName("shiftOcr");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      // Same Shift Labs API key as the shiftLabs plugin; the cloud
      // derives the organization from it, so no org ID is needed.
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  rl.registerAction("ocr.extract", {
    access: "write",
    description:
      "Extract markdown text — and optionally schema-constrained JSON — " +
      "from an image or PDF. Pass a local file path (small files inline; " +
      "large ones upload to the org's object bucket automatically), an " +
      "https URL, or the objectId of a stored object. Provide schema to " +
      "get structured fields back instead of parsing the text yourself.",
    inputSchema: t.Object(
      {
        path: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description: "Host path of an image or PDF (max 20 MiB)",
          }),
        ),
        url: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description: "https or data URL of the image or PDF",
          }),
        ),
        objectId: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description:
              "ID of a ready object in the organization's durable bucket",
          }),
        ),
        kind: t.Optional(
          t.Union([t.Literal("image"), t.Literal("document")], {
            description:
              "Override for URLs whose extension does not reveal the type. " +
              "Inferred from the extension otherwise.",
          }),
        ),
        provider: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description:
              "Provider ID from ocr.providers. Defaults to the first " +
              "catalog provider.",
          }),
        ),
        model: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description:
              "Model override. Defaults to the provider's defaultModel.",
          }),
        ),
        pages: t.Optional(
          t.String({
            minLength: 1,
            pattern: "^\\d+(-\\d+)?(,\\d+(-\\d+)?)*$",
            description:
              "Zero-based pages for PDFs, e.g. '0', '0-5', or '0,2-4'",
          }),
        ),
        schema: t.Optional(
          t.Record(t.String(), t.Unknown(), {
            description:
              "JSON schema for structured extraction across the document",
          }),
        ),
        schemaName: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description: "Extractor name for provenance. Default: extraction",
          }),
        ),
        prompt: t.Optional(
          t.String({
            minLength: 1,
            pattern: "\\S",
            description: "Guidance for structured extraction; requires schema",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        path?: string;
        url?: string;
        objectId?: string;
        kind?: "image" | "document";
        provider?: string;
        model?: string;
        pages?: string;
        schema?: Record<string, unknown>;
        schemaName?: string;
        prompt?: string;
      };
      const sources = [fields.path, fields.url, fields.objectId].filter(
        (value) => value !== undefined,
      );
      if (sources.length !== 1) {
        throw new Error("Provide exactly one of path, url, or objectId");
      }
      if (fields.prompt && !fields.schema) {
        throw new Error("prompt requires schema");
      }
      const document = fields.objectId
        ? { type: "object", objectId: fields.objectId }
        : fields.path
          ? await documentFromPath(ctx as Ctx, fields.path)
          : documentFromUrl(fields.url as string, fields.kind);

      return await request(ctx as Ctx, "/v1/services/ocr/extract", {
        method: "POST",
        body: JSON.stringify({
          document,
          ...(fields.provider ? { provider: fields.provider } : {}),
          ...(fields.model ? { model: fields.model } : {}),
          ...(fields.pages ? { pages: fields.pages } : {}),
          ...(fields.schema
            ? {
                structured: {
                  name: fields.schemaName ?? "extraction",
                  schema: fields.schema,
                  ...(fields.prompt ? { prompt: fields.prompt } : {}),
                },
              }
            : {}),
        }),
      });
    },
  });

  rl.registerAction("ocr.providers", {
    access: "read",
    description: "List the OCR providers and models available.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ providers: unknown[] }>(
        ctx as Ctx,
        "/v1/services/ocr/providers",
      );
      return body.providers;
    },
  });
}
