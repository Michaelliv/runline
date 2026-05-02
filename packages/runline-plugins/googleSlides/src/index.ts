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
import { googleAccessToken } from "../../_shared/googleAuth.js";

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

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleSlides", SCOPES);
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
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`googleSlides: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

// ─── Helpers ────────────────────────────────────────────────────

const PRES_URL_REGEX =
  /https:\/\/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9-_]+)/;

/**
 * Accept a bare presentation ID or a full docs.google.com URL.
 * Falls through to the input unchanged if no URL is detected.
 */
function extractPresentationId(input: string): string {
  if (!input) throw new Error("googleSlides: presentationId or URL is required");
  const m = input.match(PRES_URL_REGEX);
  return m ? m[1] : input;
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/presentations"];

export default function googleSlides(rl: RunlinePluginAPI) {
  rl.setName("googleSlides");
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
      "2. Enable the Google Slides API:",
      "     https://console.cloud.google.com/apis/library/slides.googleapis.com",
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
      "   GOOGLE_SLIDES_CLIENT_ID and GOOGLE_SLIDES_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, env: "GOOGLE_SLIDES_CLIENT_ID" },
    clientSecret: { type: "string", required: false, env: "GOOGLE_SLIDES_CLIENT_SECRET" },
    refreshToken: { type: "string", required: false, env: "GOOGLE_SLIDES_REFRESH_TOKEN" },
    serviceAccountJson: { type: "string", required: false, env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_JSON" },
    serviceAccountEmail: { type: "string", required: false, env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_EMAIL" },
    serviceAccountPrivateKey: { type: "string", required: false, env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_PRIVATE_KEY" },
    serviceAccountSubject: { type: "string", required: false, env: "GOOGLE_SLIDES_SERVICE_ACCOUNT_SUBJECT" },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Presentation ──────────────────────────────────────

  rl.registerAction("presentation.create", {
    description: "Create a new empty presentation",
    inputSchema: { title: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return slidesRequest(ctx, "POST", "/presentations", { title: p.title });
    },
  });

  rl.registerAction("presentation.get", {
    description:
      "Get a presentation. Accepts a bare ID or a docs.google.com/presentation URL.",
    inputSchema: {
      presentation: { type: "string", required: true },
      fields: {
        type: "string",
        required: false,
        description: "Fields projection (e.g. 'slides' to get slides only)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const qs: Record<string, unknown> = {};
      if (p.fields) qs.fields = p.fields;
      return slidesRequest(ctx, "GET", `/presentations/${id}`, undefined, qs);
    },
  });

  rl.registerAction("presentation.listSlides", {
    description: "List slides in a presentation",
    inputSchema: {
      presentation: { type: "string", required: true },
      limit: { type: "number", required: false, description: "Max number of slides to return" },
    },
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
    description:
      "Replace text in a presentation. Pass one or more {text, replaceText, matchCase?, pageObjectIds?} entries; each becomes a replaceAllText request in a single batchUpdate.",
    inputSchema: {
      presentation: { type: "string", required: true },
      replacements: {
        type: "array",
        required: true,
        description:
          "[{text, replaceText, matchCase?, pageObjectIds?}] — pageObjectIds limits the scope to specific slides",
      },
      revisionId: {
        type: "string",
        required: false,
        description:
          "If set, request fails unless the presentation's current revisionId matches",
      },
    },
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
      return slidesRequest(ctx, "POST", `/presentations/${id}:batchUpdate`, body);
    },
  });

  rl.registerAction("presentation.batchUpdate", {
    description:
      "Raw passthrough to presentations.batchUpdate — pass a full `requests` array for layout edits, shape inserts, transform updates, etc.",
    inputSchema: {
      presentation: { type: "string", required: true },
      requests: { type: "array", required: true },
      writeControl: {
        type: "object",
        required: false,
        description: "{requiredRevisionId}",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const body: Record<string, unknown> = { requests: p.requests };
      if (p.writeControl) body.writeControl = p.writeControl;
      return slidesRequest(ctx, "POST", `/presentations/${id}:batchUpdate`, body);
    },
  });

  // ── Page (slide) ──────────────────────────────────────

  rl.registerAction("page.get", {
    description: "Get a single slide (page) by objectId",
    inputSchema: {
      presentation: { type: "string", required: true },
      pageObjectId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      return slidesRequest(ctx, "GET", `/presentations/${id}/pages/${p.pageObjectId}`);
    },
  });

  rl.registerAction("page.getThumbnail", {
    description:
      "Get a thumbnail for a slide. Returns Slides' response { contentUrl, width, height } by default; set `savePath` to also download the PNG to disk, or `download=true` to return base64.",
    inputSchema: {
      presentation: { type: "string", required: true },
      pageObjectId: { type: "string", required: true },
      mimeType: {
        type: "string",
        required: false,
        description: "PNG (default) — the only type Slides currently exposes",
      },
      thumbnailSize: {
        type: "string",
        required: false,
        description: "THUMBNAIL_SIZE_UNSPECIFIED (default) | LARGE | MEDIUM | SMALL",
      },
      savePath: {
        type: "string",
        required: false,
        description: "Write the PNG bytes to this filesystem path",
      },
      download: {
        type: "boolean",
        required: false,
        description: "If true (and no savePath), include base64 bytes in the response",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const id = extractPresentationId(p.presentation as string);
      const qs: Record<string, unknown> = {};
      if (p.mimeType) qs["thumbnailProperties.mimeType"] = p.mimeType;
      if (p.thumbnailSize) qs["thumbnailProperties.thumbnailSize"] = p.thumbnailSize;
      const res = (await slidesRequest(
        ctx,
        "GET",
        `/presentations/${id}/pages/${p.pageObjectId}/thumbnail`,
        undefined,
        qs,
      )) as { contentUrl: string; width?: number; height?: number };

      if (!p.savePath && !p.download) return res;

      // contentUrl is a signed Google URL — fetch without auth headers.
      const imgRes = await fetch(res.contentUrl);
      if (!imgRes.ok) {
        throw new Error(
          `googleSlides: thumbnail fetch failed (${imgRes.status}): ${await imgRes.text()}`,
        );
      }
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      if (typeof p.savePath === "string") {
        writeFileSync(p.savePath, bytes);
        return { ...res, path: p.savePath, size: bytes.byteLength };
      }
      return { ...res, size: bytes.byteLength, contentBase64: bytes.toString("base64") };
    },
  });
}
