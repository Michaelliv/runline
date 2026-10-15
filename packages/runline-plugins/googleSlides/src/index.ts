/**
 * Google Slides plugin for runline.
 *
 * OAuth2 user flow, same shape as the rest of the Google plugins.
 * Scope: `auth/presentations` (full read/write on user's decks).
 *
 * Surface area:
 *   presentation.create / presentation.get
 *   presentation.listSlides
 *   presentation.replaceText      (one or more find/replace pairs)
 *   presentation.batchUpdate      (raw passthrough)
 *
 *   page.get                      (a single slide by objectId)
 *   page.getThumbnail             (returns a signed URL by default;
 *                                  set `savePath` to download to disk)
 *
 * Anything this plugin doesn't expose directly — layout edits,
 * shape inserts, transform updates — goes through
 * `presentation.batchUpdate`, which is a pass-through to Slides'
 * `POST /v1/presentations/{id}:batchUpdate` endpoint.
 */

import { writeFileSync } from "node:fs";
import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { pathSegment } from "../../_shared/credentials.js";
import {
  googleCredential,
  googleDownload,
  googleJsonRequest,
  googleOAuth,
} from "../../_shared/googleAuth.js";
import {
  Id,
  NonEmptyString,
  PositiveInteger,
  RawGoogleObject,
  StringArray,
  stringEnum,
} from "../../_shared/googleSchemas.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleSlidesConfig = {
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

interface ReplaceTextEntry {
  text: string;
  replaceText: string;
  matchCase?: boolean;
  pageObjectIds?: string[];
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://slides.googleapis.com/v1";

async function slidesRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return googleJsonRequest(ctx, "googleSlides", SCOPES, method, `${API_BASE}${path}`, body, qs);
}

// ─── Helpers ────────────────────────────────────────────────────

const PRES_URL_REGEX =
  /https:\/\/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9-_]+)/;

/**
 * Accept a bare presentation ID or a full docs.google.com URL.
 * Falls through to the input unchanged if no URL is detected.
 */
function extractPresentationId(input: string): string {
  if (!input)
    throw new Error("googleSlides: presentationId or URL is required");
  const m = input.match(PRES_URL_REGEX);
  return pathSegment(m ? m[1] : input);
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/presentations"];

export default function googleSlides(rl: RunlinePluginAPI) {
  rl.setName("googleSlides");
  rl.setVersion("0.1.0");
  rl.setCredential(googleCredential("googleSlides", SCOPES));

  rl.setOAuth(googleOAuth("googleSlides", SCOPES, "GOOGLE_SLIDES"));

  rl.setConnectionSchema({
    authMethod: { type: "string", required: false, description: "delegated or serviceAccount (legacy configs infer the method)" },
    clientId: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Presentation ──────────────────────────────────────

  rl.registerAction("presentation.create", {
    access: "write",
    description: "Create a new empty presentation",
    inputSchema: t.Object(
      { title: NonEmptyString },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return slidesRequest(ctx, "POST", "/presentations", { title: p.title });
    },
  });

  rl.registerAction("presentation.get", {
    access: "read",
    description:
      "Get a presentation. Accepts a bare ID or a docs.google.com/presentation URL.",
    inputSchema: t.Object(
      {
        presentation: Id,
        fields: t.Optional(NonEmptyString),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const qs: Record<string, unknown> = {};
      if (p.fields) qs.fields = p.fields;
      return slidesRequest(ctx, "GET", `/presentations/${id}`, undefined, qs);
    },
  });

  rl.registerAction("presentation.listSlides", {
    access: "read",
    description: "List slides in a presentation",
    inputSchema: t.Object(
      {
        presentation: Id,
        limit: t.Optional(PositiveInteger),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const res = (await slidesRequest(
        ctx,
        "GET",
        `/presentations/${id}`,
        undefined,
        { fields: "slides" },
      )) as { slides?: unknown[] };
      const slides = res.slides ?? [];
      if (typeof p.limit === "number") return slides.slice(0, p.limit);
      return slides;
    },
  });

  rl.registerAction("presentation.replaceText", {
    access: "write",
    description:
      "Replace text in a presentation. Pass one or more {text, replaceText, matchCase?, pageObjectIds?} entries; each becomes a replaceAllText request in a single batchUpdate.",
    inputSchema: t.Object(
      {
        presentation: Id,
        replacements: t.Array(
          t.Object(
            {
              text: NonEmptyString,
              replaceText: t.String(),
              matchCase: t.Optional(t.Boolean()),
              pageObjectIds: t.Optional(StringArray),
            },
            { additionalProperties: false },
          ),
          { minItems: 1 },
        ),
        revisionId: t.Optional(Id),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const replacements = p.replacements as ReplaceTextEntry[];
      if (!Array.isArray(replacements) || replacements.length === 0) {
        throw new Error("googleSlides: replacements must be a non-empty array");
      }
      const requests = replacements.map((r) => ({
        replaceAllText: {
          replaceText: r.replaceText,
          pageObjectIds: r.pageObjectIds ?? [],
          containsText: {
            text: r.text,
            matchCase: r.matchCase === true,
          },
        },
      }));
      const body: Record<string, unknown> = { requests };
      if (p.revisionId) {
        body.writeControl = { requiredRevisionId: p.revisionId };
      }
      return slidesRequest(
        ctx,
        "POST",
        `/presentations/${id}:batchUpdate`,
        body,
      );
    },
  });

  rl.registerAction("presentation.batchUpdate", {
    access: "write",
    description:
      "Raw passthrough to presentations.batchUpdate — pass a full `requests` array for layout edits, shape inserts, transform updates, etc.",
    inputSchema: t.Object(
      {
        presentation: Id,
        requests: t.Array(RawGoogleObject, { minItems: 1 }),
        writeControl: t.Optional(
          t.Object({ requiredRevisionId: Id }, { additionalProperties: false }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const body: Record<string, unknown> = { requests: p.requests };
      if (p.writeControl) body.writeControl = p.writeControl;
      return slidesRequest(
        ctx,
        "POST",
        `/presentations/${id}:batchUpdate`,
        body,
      );
    },
  });

  // ── Page (slide) ──────────────────────────────────────

  rl.registerAction("page.get", {
    access: "read",
    description: "Get a single slide (page) by objectId",
    inputSchema: t.Object(
      {
        presentation: Id,
        pageObjectId: Id,
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      return slidesRequest(
        ctx,
        "GET",
        `/presentations/${id}/pages/${pathSegment(p.pageObjectId)}`,
      );
    },
  });

  rl.registerAction("page.getThumbnail", {
    access: "write",
    description:
      "Get a thumbnail for a slide. Returns Slides' response { contentUrl, width, height } by default; set `savePath` to also download the PNG to disk, or `download=true` to return base64.",
    inputSchema: t.Object(
      {
        presentation: Id,
        pageObjectId: Id,
        mimeType: t.Optional(t.Literal("PNG")),
        thumbnailSize: t.Optional(
          stringEnum([
            "THUMBNAIL_SIZE_UNSPECIFIED",
            "LARGE",
            "MEDIUM",
            "SMALL",
          ] as const),
        ),
        savePath: t.Optional(NonEmptyString),
        download: t.Optional(t.Boolean()),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const qs: Record<string, unknown> = {};
      if (p.mimeType) qs["thumbnailProperties.mimeType"] = p.mimeType;
      if (p.thumbnailSize)
        qs["thumbnailProperties.thumbnailSize"] = p.thumbnailSize;
      const res = (await slidesRequest(
        ctx,
        "GET",
        `/presentations/${id}/pages/${pathSegment(p.pageObjectId)}/thumbnail`,
        undefined,
        qs,
      )) as { contentUrl: string; width?: number; height?: number };

      if (!p.savePath && !p.download) return res;

      // contentUrl is a signed Google URL — fetch without auth headers.
      const imgRes = await googleDownload(res.contentUrl);
      if (!imgRes.ok) {
        throw new Error(
          `googleSlides: thumbnail fetch failed (HTTP ${imgRes.status})`,
        );
      }
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      if (typeof p.savePath === "string") {
        writeFileSync(p.savePath, bytes);
        return { ...res, path: p.savePath, size: bytes.byteLength };
      }
      return {
        ...res,
        size: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      };
    },
  });
}
