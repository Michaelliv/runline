import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { type Ctx, request, STRICT_OBJECT } from "../../_shared/shiftCloud.js";

/**
 * Shift OCR — text and structured-field extraction from images and
 * PDFs through the Shift cloud OCR service. The API key is the tenant
 * authority; no organization ID is ever sent (SHFT-852).
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
 * by 4/3, so 20 MiB raw stays well inside provider request limits.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface OcrDocumentRef {
  type: "image" | "document";
  url: string;
  name?: string;
}

async function documentFromPath(path: string): Promise<OcrDocumentRef> {
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
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`${path} is not a file`);
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${file.size} bytes; inline OCR uploads are capped at ${MAX_FILE_BYTES} bytes. Host the file and pass url instead.`,
    );
  }
  const mediaType = imageType ?? documentType;
  const url = `data:${mediaType};base64,${(await readFile(path)).toString("base64")}`;
  return imageType
    ? { type: "image", url }
    : { type: "document", url, name: path.replace(/.*\//, "") };
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
      "from an image or PDF. Pass a local file path (inlined as a data " +
      "URL) or an https URL. Provide schema to get structured fields " +
      "back instead of parsing the text yourself.",
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
        kind: t.Optional(
          t.Union([t.Literal("image"), t.Literal("document")], {
            description:
              "Override for URLs whose extension does not reveal the type. " +
              "Inferred from the extension otherwise.",
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
        kind?: "image" | "document";
        pages?: string;
        schema?: Record<string, unknown>;
        schemaName?: string;
        prompt?: string;
      };
      if (!fields.path === !fields.url) {
        throw new Error("Provide exactly one of path or url");
      }
      if (fields.prompt && !fields.schema) {
        throw new Error("prompt requires schema");
      }
      const document = fields.path
        ? await documentFromPath(fields.path)
        : documentFromUrl(fields.url as string, fields.kind);

      return await request(ctx as Ctx, "/v1/services/ocr/extract", {
        method: "POST",
        body: JSON.stringify({
          document,
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
