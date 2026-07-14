import type { ActionContext } from "runline";
import * as t from "typebox";
import { googleAccessToken } from "../../_shared/googleAuth.js";
import { RawGoogleObject } from "../../_shared/googleSchemas.js";

export type Ctx = ActionContext;

export type GoogleDocsConfig = {
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

export const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

export const DOCS_BASE = "https://docs.googleapis.com/v1";
export const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

export const STRICT_OBJECT = { additionalProperties: false } as const;
export const DocumentInput = {
  document: t.String({ minLength: 1, description: "Document ID or URL" }),
};
export const SegmentInput = {
  segmentId: t.Optional(
    t.String({ description: 'Segment ID, or "body" for the main body' }),
  ),
  tabId: t.Optional(t.String({ minLength: 1 })),
};
export const RangeInput = {
  startIndex: t.Integer({ minimum: 0 }),
  endIndex: t.Integer({ minimum: 0 }),
  ...SegmentInput,
};
export const TableLocationInput = {
  tableStartIndex: t.Integer({ minimum: 0 }),
  rowIndex: t.Integer({ minimum: 0 }),
  columnIndex: t.Integer({ minimum: 0 }),
  ...SegmentInput,
};
export const LocationInput = {
  locationKind: t.Optional(
    t.Union([t.Literal("location"), t.Literal("endOfSegmentLocation")]),
  ),
  index: t.Optional(t.Integer({ minimum: 0 })),
  ...SegmentInput,
};
export const LOCATION_REQUIREMENT = [
  {
    required: ["index"],
    not: {
      required: ["locationKind"],
      properties: { locationKind: { const: "endOfSegmentLocation" } },
    },
  },
  {
    required: ["locationKind"],
    properties: { locationKind: { const: "endOfSegmentLocation" } },
    not: { required: ["index"] },
  },
] as const;
export const HexColor = t.String({
  pattern: "^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
});
export const PositivePoints = t.Number({ minimum: 0 });
export const WriteControl = t.Object(
  {
    requiredRevisionId: t.Optional(t.String({ minLength: 1 })),
    targetRevisionId: t.Optional(t.String({ minLength: 1 })),
  },
  {
    additionalProperties: false,
    oneOf: [
      { required: ["requiredRevisionId"] },
      { required: ["targetRevisionId"] },
    ],
  },
);
export { RawGoogleObject };

export async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleDocs", SCOPES);
}

export async function docsRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  baseOverride?: string,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${baseOverride ?? DOCS_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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
    throw new Error(`googleDocs: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

const DOC_URL_REGEX =
  /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;

export function extractDocumentId(input: string): string {
  if (!input) throw new Error("googleDocs: documentId or URL is required");
  const m = input.match(DOC_URL_REGEX);
  return m ? m[1] : input;
}

export function buildLocation(
  kind: "location" | "endOfSegmentLocation",
  segmentId?: string,
  index?: number,
  tabId?: string,
): Record<string, unknown> {
  const seg = segmentId && segmentId !== "body" ? segmentId : "";
  if (kind === "endOfSegmentLocation") {
    return { endOfSegmentLocation: compact({ segmentId: seg, tabId }) };
  }
  if (index === undefined || index === null) {
    throw new Error(
      "googleDocs: `index` is required when location kind is 'location'",
    );
  }
  return { location: location(index, segmentId, tabId) };
}

export function location(
  index: number,
  segmentId?: string,
  tabId?: string,
): Record<string, unknown> {
  const seg = segmentId && segmentId !== "body" ? segmentId : "";
  return compact({ segmentId: seg, index, tabId });
}

export function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null) delete obj[key];
  }
  return obj;
}

export async function runBatchUpdate(
  ctx: Ctx,
  documentId: string,
  requestOrRequests: Record<string, unknown> | Array<Record<string, unknown>>,
  writeControl?: Record<string, unknown>,
): Promise<unknown> {
  const requests = Array.isArray(requestOrRequests)
    ? requestOrRequests
    : [requestOrRequests];
  const body: Record<string, unknown> = { requests };
  if (writeControl) body.writeControl = writeControl;
  const res = (await docsRequest(
    ctx,
    "POST",
    `/documents/${documentId}:batchUpdate`,
    body,
  )) as { replies?: Array<Record<string, unknown>>; documentId?: string };
  if (requests.length !== 1) return { documentId, replies: res.replies ?? [] };
  const reply = res.replies?.[0] ?? {};
  const key = Object.keys(reply)[0];
  return { documentId, ...(key ? { [key]: reply[key] } : {}) };
}

export function flattenBodyText(body: unknown): string {
  const parts: string[] = [];
  const content =
    (body as { content?: Array<Record<string, unknown>> })?.content ?? [];
  for (const item of content) {
    const para = item.paragraph as
      | { elements?: Array<Record<string, unknown>> }
      | undefined;
    if (!para?.elements) continue;
    for (const el of para.elements) {
      const tr = el.textRun as { content?: string } | undefined;
      if (tr?.content) parts.push(tr.content);
    }
  }
  return parts.join("");
}

export function hexToRgbF(hex: string): {
  red: number;
  green: number;
  blue: number;
} {
  const h = hex.replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}
