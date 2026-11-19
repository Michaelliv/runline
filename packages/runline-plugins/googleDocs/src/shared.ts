import { type ActionContext, pathSegment } from "runline";
import * as t from "typebox";
import { googleJsonRequest } from "../../_shared/googleAuth.js";
import { RawGoogleObject } from "../../_shared/googleSchemas.js";
import { exactlyOne, STRICT } from "../../_shared/schemas.js";

export type Ctx = ActionContext;

export const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

export const DOCS_BASE = "https://docs.googleapis.com/v1";
export const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

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
export const PositivePoints = t.Number({ minimum: 0 });
const revisionControls = {
  requiredRevisionId: t.Optional(t.String({ minLength: 1 })),
  targetRevisionId: t.Optional(t.String({ minLength: 1 })),
};
export const WriteControl = t.Object(revisionControls, {
  ...STRICT,
  ...exactlyOne(revisionControls),
});
export { RawGoogleObject };

export async function docsRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  baseOverride?: string,
): Promise<unknown> {
  return googleJsonRequest(
    ctx,
    "googleDocs",
    SCOPES,
    method,
    `${baseOverride ?? DOCS_BASE}${path}`,
    body,
    qs,
  );
}

const DOC_URL_REGEX =
  /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;

export function extractDocumentId(input: string): string {
  const m = input.match(DOC_URL_REGEX);
  return pathSegment(m ? m[1] : input);
}

/** A segment's ID as the API takes it: `body` names the main one, whose ID is empty. */
export function segment(segmentId: string | undefined): string {
  return segmentId && segmentId !== "body" ? segmentId : "";
}

/** Where a `LocationInput` points. */
export type Place = {
  locationKind?: "location" | "endOfSegmentLocation";
  index?: number;
  segmentId?: string;
  tabId?: string;
};

/** A request's `location`, or its `endOfSegmentLocation`. */
export function buildLocation(p: Place): Record<string, unknown> {
  if (p.locationKind === "endOfSegmentLocation")
    return {
      endOfSegmentLocation: compact({
        segmentId: segment(p.segmentId),
        tabId: p.tabId,
      }),
    };
  // The schema requires an index for this kind; the type cannot say so.
  if (p.index === undefined)
    throw new Error("googleDocs: a location takes an index");
  return { location: location(p.index, p.segmentId, p.tabId) };
}

export function location(
  index: number,
  segmentId?: string,
  tabId?: string,
): Record<string, unknown> {
  return compact({ segmentId: segment(segmentId), index, tabId });
}

/** A length in points, as the Docs API takes a Dimension. */
export function points(magnitude: number): Record<string, unknown> {
  return { magnitude, unit: "PT" };
}

/** A range of a segment. */
export function range(p: {
  startIndex: number;
  endIndex: number;
  segmentId?: string;
  tabId?: string;
}): Record<string, unknown> {
  return compact({
    segmentId: segment(p.segmentId),
    startIndex: p.startIndex,
    endIndex: p.endIndex,
    tabId: p.tabId,
  });
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
