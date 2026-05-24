/**
 * Google Docs plugin for runline.
 *
 * OAuth2 user flow, same shape as the rest of the Google plugins.
 * Scopes: `auth/documents` for docs; `auth/drive.file` is added
 * because `document.create` goes through Drive's files endpoint
 * — the Docs API itself only creates blank documents without a
 * target folder.
 *
 * Surface area:
 *
 *   document.create
 *   document.get                    (optional `simple=true` returns flat text)
 *   document.batchUpdate            (raw request list)
 *
 * Plus convenience helpers that wrap the most common batchUpdate
 * shapes as first-class actions, addressable without constructing
 * the nested request objects by hand:
 *
 *   document.insertText
 *   document.replaceAllText
 *   document.deleteContentRange
 *   document.insertTable
 *   document.insertPageBreak
 *   document.createParagraphBullets
 *   document.deleteParagraphBullets
 *   document.createNamedRange
 *   document.deleteNamedRange
 *   document.createHeader / document.deleteHeader
 *   document.createFooter / document.deleteFooter
 *   document.deletePositionedObject
 *   document.insertTableRow / document.deleteTableRow
 *   document.insertTableColumn / document.deleteTableColumn
 *
 * Every helper ultimately hits `POST /v1/documents/{id}:batchUpdate`
 * with a single request; callers who need to chain multiple edits
 * atomically can compose them via `document.batchUpdate`.
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import { googleAccessToken } from "../../_shared/googleAuth.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleDocsConfig = {
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

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleDocs", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const DOCS_BASE = "https://docs.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

async function docsRequest(
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
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
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

// ─── Helpers ────────────────────────────────────────────────────

const DOC_URL_REGEX = /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/;

/**
 * Accept a bare document ID or a full docs.google.com URL and return
 * the ID. Falls through to the input unchanged if no URL is detected.
 */
function extractDocumentId(input: string): string {
  if (!input) throw new Error("googleDocs: documentId or URL is required");
  const m = input.match(DOC_URL_REGEX);
  return m ? m[1] : input;
}

/**
 * Build a `Location` object for Docs insert requests. When
 * `segmentId` is "body" or missing, send an empty segmentId — Docs
 * treats that as "the document body". `index` is required for
 * `location`; `endOfSegmentLocation` doesn't take one.
 */
function buildLocation(
  kind: "location" | "endOfSegmentLocation",
  segmentId?: string,
  index?: number,
): Record<string, unknown> {
  const seg = segmentId && segmentId !== "body" ? segmentId : "";
  if (kind === "endOfSegmentLocation") {
    return { endOfSegmentLocation: { segmentId: seg } };
  }
  if (index === undefined || index === null) {
    throw new Error("googleDocs: `index` is required when location kind is 'location'");
  }
  return { location: { segmentId: seg, index } };
}

async function runBatchUpdate(
  ctx: Ctx,
  documentId: string,
  request: Record<string, unknown>,
  writeControl?: Record<string, unknown>,
): Promise<unknown> {
  const body: Record<string, unknown> = { requests: [request] };
  if (writeControl) body.writeControl = writeControl;
  const res = (await docsRequest(
    ctx,
    "POST",
    `/documents/${documentId}:batchUpdate`,
    body,
  )) as { replies?: Array<Record<string, unknown>>; documentId?: string };
  // Flatten single-request replies so callers don't have to drill in.
  const reply = res.replies?.[0] ?? {};
  const key = Object.keys(reply)[0];
  return { documentId, ...(key ? { [key]: reply[key] } : {}) };
}

/**
 * Walk a `document.body.content` tree and concatenate every
 * `textRun.content` we find — the `simple=true` output on
 * `document.get`. Intentionally ignores tables, headers, footers,
 * and inline objects.
 */
function flattenBodyText(body: unknown): string {
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

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];


function hexToRgbF(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return {
    red:   ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff)  / 255,
    blue:  ( n        & 0xff) / 255,
  };
}

export default function googleDocs(rl: RunlinePluginAPI) {
  rl.setName("googleDocs");
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
      "2. Enable the Google Docs API (and Drive API for document.create):",
      "     https://console.cloud.google.com/apis/library/docs.googleapis.com",
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
      "   GOOGLE_DOCS_CLIENT_ID and GOOGLE_DOCS_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, env: "GOOGLE_DOCS_CLIENT_ID" },
    clientSecret: { type: "string", required: false, env: "GOOGLE_DOCS_CLIENT_SECRET" },
    refreshToken: { type: "string", required: false, env: "GOOGLE_DOCS_REFRESH_TOKEN" },
    serviceAccountJson: { type: "string", required: false, env: "GOOGLE_DOCS_SERVICE_ACCOUNT_JSON" },
    serviceAccountEmail: { type: "string", required: false, env: "GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL" },
    serviceAccountPrivateKey: { type: "string", required: false, env: "GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY" },
    serviceAccountSubject: { type: "string", required: false, env: "GOOGLE_DOCS_SERVICE_ACCOUNT_SUBJECT" },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Document lifecycle ────────────────────────────────

  rl.registerAction("document.create", {
    description:
      "Create a new Google Doc, optionally in a specific Drive folder (goes through the Drive API; needs drive.file scope).",
    inputSchema: {
      title: { type: "string", required: true },
      folderId: {
        type: "string",
        required: false,
        description: "Parent folder in Drive. Omit to place in My Drive root.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.title,
        mimeType: "application/vnd.google-apps.document",
      };
      if (p.folderId) {
        body.parents = [p.folderId];
      }
      return docsRequest(ctx, "POST", "/files", body, undefined, DRIVE_BASE);
    },
  });

  rl.registerAction("document.get", {
    description:
      "Get a document. Accepts a bare ID or a docs.google.com URL. `simple=true` collapses the body to plain text.",
    inputSchema: {
      document: { type: "string", required: true, description: "Document ID or URL" },
      simple: { type: "boolean", required: false },
      suggestionsViewMode: {
        type: "string",
        required: false,
        description:
          "DEFAULT_FOR_CURRENT_ACCESS | SUGGESTIONS_INLINE | PREVIEW_SUGGESTIONS_ACCEPTED | PREVIEW_WITHOUT_SUGGESTIONS",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const qs: Record<string, unknown> = {};
      if (p.suggestionsViewMode) qs.suggestionsViewMode = p.suggestionsViewMode;
      const res = (await docsRequest(
        ctx,
        "GET",
        `/documents/${documentId}`,
        undefined,
        qs,
      )) as { body?: unknown };
      if (!p.simple) return res;
      return { documentId, content: flattenBodyText(res.body) };
    },
  });

  rl.registerAction("document.batchUpdate", {
    description:
      "Raw passthrough to documents.batchUpdate — pass a full `requests` array for atomic multi-edit operations.",
    inputSchema: {
      document: { type: "string", required: true },
      requests: { type: "array", required: true },
      writeControl: {
        type: "object",
        required: false,
        description: "{requiredRevisionId} | {targetRevisionId}",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const body: Record<string, unknown> = {
        requests: p.requests,
      };
      if (p.writeControl) body.writeControl = p.writeControl;
      return docsRequest(ctx, "POST", `/documents/${documentId}:batchUpdate`, body);
    },
  });

  // ── Text edits ────────────────────────────────────────

  rl.registerAction("document.insertText", {
    description:
      "Insert text at a specific index, or at the end of a segment (body/header/footer/footnote).",
    inputSchema: {
      document: { type: "string", required: true },
      text: { type: "string", required: true },
      locationKind: {
        type: "string",
        required: false,
        description: "location (default; requires index) | endOfSegmentLocation",
      },
      index: { type: "number", required: false, description: "Required for locationKind=location" },
      segmentId: {
        type: "string",
        required: false,
        description: 'Segment ID, or "body" / empty for the main body',
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind = (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const locObj = buildLocation(kind, p.segmentId as string, p.index as number);
      return runBatchUpdate(ctx, documentId, {
        insertText: { text: p.text, ...locObj },
      });
    },
  });

  rl.registerAction("document.replaceAllText", {
    description: "Replace every occurrence of a text string throughout the document.",
    inputSchema: {
      document: { type: "string", required: true },
      findText: { type: "string", required: true },
      replaceText: { type: "string", required: true },
      matchCase: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        replaceAllText: {
          replaceText: p.replaceText,
          containsText: { text: p.findText, matchCase: p.matchCase === true },
        },
      });
    },
  });

  rl.registerAction("document.deleteContentRange", {
    description: "Delete text between two indices in a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteContentRange: {
          range: {
            segmentId: seg,
            startIndex: p.startIndex,
            endIndex: p.endIndex,
          },
        },
      });
    },
  });

  // ── Structural inserts ────────────────────────────────

  rl.registerAction("document.insertPageBreak", {
    description: "Insert a page break at an index or at the end of a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind = (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        insertPageBreak: buildLocation(kind, p.segmentId as string, p.index as number),
      });
    },
  });

  rl.registerAction("document.insertTable", {
    description: "Insert an empty table with the given dimensions.",
    inputSchema: {
      document: { type: "string", required: true },
      rows: { type: "number", required: true },
      columns: { type: "number", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind = (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        insertTable: {
          rows: p.rows,
          columns: p.columns,
          ...buildLocation(kind, p.segmentId as string, p.index as number),
        },
      });
    },
  });

  rl.registerAction("document.insertTableRow", {
    description: "Insert a table row above or below a cell in an existing table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: {
        type: "number",
        required: true,
        description: "Document index where the table begins",
      },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      insertBelow: { type: "boolean", required: false, description: "default: false (insert above)" },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        insertTableRow: {
          insertBelow: p.insertBelow === true,
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
        },
      });
    },
  });

  rl.registerAction("document.deleteTableRow", {
    description: "Delete a specific row from a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteTableRow: {
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
        },
      });
    },
  });

  rl.registerAction("document.insertTableColumn", {
    description: "Insert a column left or right of a cell.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      insertRight: { type: "boolean", required: false, description: "default: false (insert left)" },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        insertTableColumn: {
          insertRight: p.insertRight === true,
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
        },
      });
    },
  });

  rl.registerAction("document.deleteTableColumn", {
    description: "Delete a specific column from a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteTableColumn: {
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
        },
      });
    },
  });

  // ── Bullets ───────────────────────────────────────────

  rl.registerAction("document.createParagraphBullets", {
    description:
      "Apply a bullet preset to paragraphs spanning a range. Presets: BULLET_DISC_CIRCLE_SQUARE, BULLET_DIAMONDX_ARROW3D_SQUARE, BULLET_CHECKBOX, NUMBERED_DECIMAL_ALPHA_ROMAN, NUMBERED_DECIMAL_NESTED, etc.",
    inputSchema: {
      document: { type: "string", required: true },
      bulletPreset: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        createParagraphBullets: {
          bulletPreset: p.bulletPreset,
          range: { segmentId: seg, startIndex: p.startIndex, endIndex: p.endIndex },
        },
      });
    },
  });

  rl.registerAction("document.deleteParagraphBullets", {
    description: "Remove bullets from paragraphs in a range.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteParagraphBullets: {
          range: { segmentId: seg, startIndex: p.startIndex, endIndex: p.endIndex },
        },
      });
    },
  });

  // ── Named ranges ──────────────────────────────────────

  rl.registerAction("document.createNamedRange", {
    description: "Create a named range over a span of text (useful for later programmatic edits).",
    inputSchema: {
      document: { type: "string", required: true },
      name: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        createNamedRange: {
          name: p.name,
          range: { segmentId: seg, startIndex: p.startIndex, endIndex: p.endIndex },
        },
      });
    },
  });

  rl.registerAction("document.deleteNamedRange", {
    description:
      "Delete named range(s). Pass one of `namedRangeId` or `name`; the latter deletes every range sharing that name.",
    inputSchema: {
      document: { type: "string", required: true },
      namedRangeId: { type: "string", required: false },
      name: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      if (!p.namedRangeId && !p.name) {
        throw new Error("googleDocs: provide namedRangeId or name");
      }
      const req: Record<string, unknown> = p.namedRangeId
        ? { namedRangeId: p.namedRangeId }
        : { name: p.name };
      return runBatchUpdate(ctx, documentId, { deleteNamedRange: req });
    },
  });

  // ── Header / footer / positioned object ──────────────

  rl.registerAction("document.createHeader", {
    description: "Create a DEFAULT header attached to a SectionBreak.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind = (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = { segmentId: seg };
      if (kind === "location") {
        if (p.index === undefined) {
          throw new Error("googleDocs: `index` is required when locationKind=location");
        }
        sectionBreakLocation.index = p.index;
      }
      return runBatchUpdate(ctx, documentId, {
        createHeader: { type: "DEFAULT", sectionBreakLocation },
      });
    },
  });

  rl.registerAction("document.deleteHeader", {
    description: "Delete a header by ID.",
    inputSchema: {
      document: { type: "string", required: true },
      headerId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, { deleteHeader: { headerId: p.headerId } });
    },
  });

  rl.registerAction("document.createFooter", {
    description: "Create a DEFAULT footer attached to a SectionBreak.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind = (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg = p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = { segmentId: seg };
      if (kind === "location") {
        if (p.index === undefined) {
          throw new Error("googleDocs: `index` is required when locationKind=location");
        }
        sectionBreakLocation.index = p.index;
      }
      return runBatchUpdate(ctx, documentId, {
        createFooter: { type: "DEFAULT", sectionBreakLocation },
      });
    },
  });

  rl.registerAction("document.deleteFooter", {
    description: "Delete a footer by ID.",
    inputSchema: {
      document: { type: "string", required: true },
      footerId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, { deleteFooter: { footerId: p.footerId } });
    },
  });

  rl.registerAction("document.deletePositionedObject", {
    description: "Delete a positioned object (inline image, floating image, etc.) by its objectId.",
    inputSchema: {
      document: { type: "string", required: true },
      objectId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deletePositionedObject: { objectId: p.objectId },
      });
    },
  });

  // ─── Discrete text / paragraph / table formatting ────────────────
  //
  // These wrap individual batchUpdate sub-requests so the agent gets a
  // discoverable surface for the common formatting moves instead of having
  // to assemble a full batchUpdate payload.

  rl.registerAction("document.updateTextStyle", {
    description:
      "Apply text styling (bold, italic, underline, color, fontSize, fontFamily, link) to a range. Pass `fields` listing which TextStyle properties were set.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      bold: { type: "boolean", required: false },
      italic: { type: "boolean", required: false },
      underline: { type: "boolean", required: false },
      strikethrough: { type: "boolean", required: false },
      fontSizePt: { type: "number", required: false, description: "Font size in points." },
      fontFamily: { type: "string", required: false },
      foregroundColorHex: { type: "string", required: false, description: "Hex color, e.g. #1A73E8" },
      backgroundColorHex: { type: "string", required: false },
      link: { type: "string", required: false, description: "URL for the linked range." },
      segmentId: { type: "string", required: false, description: "Header/footer/footnote id; omit for the body." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ts: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.bold !== undefined)            { ts.bold = p.bold;            fields.push("bold"); }
      if (p.italic !== undefined)          { ts.italic = p.italic;        fields.push("italic"); }
      if (p.underline !== undefined)       { ts.underline = p.underline;  fields.push("underline"); }
      if (p.strikethrough !== undefined)   { ts.strikethrough = p.strikethrough; fields.push("strikethrough"); }
      if (p.fontSizePt !== undefined)      { ts.fontSize = { magnitude: p.fontSizePt, unit: "PT" }; fields.push("fontSize"); }
      if (p.fontFamily)                    { ts.weightedFontFamily = { fontFamily: p.fontFamily }; fields.push("weightedFontFamily"); }
      if (p.foregroundColorHex)            {
        const c = hexToRgbF(p.foregroundColorHex as string);
        ts.foregroundColor = { color: { rgbColor: c } };
        fields.push("foregroundColor");
      }
      if (p.backgroundColorHex)            {
        const c = hexToRgbF(p.backgroundColorHex as string);
        ts.backgroundColor = { color: { rgbColor: c } };
        fields.push("backgroundColor");
      }
      if (p.link)                          { ts.link = { url: p.link }; fields.push("link"); }
      if (fields.length === 0) {
        throw new Error("googleDocs.document.updateTextStyle: at least one styling property required");
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTextStyle: {
            range: {
              startIndex: p.startIndex,
              endIndex: p.endIndex,
              segmentId: p.segmentId,
            },
            textStyle: ts,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateParagraphStyle", {
    description:
      "Apply paragraph styling (alignment, named style, indents, spacing, direction) to the paragraphs intersecting the range.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      alignment: { type: "string", required: false, description: "START | CENTER | END | JUSTIFIED" },
      namedStyleType: { type: "string", required: false, description: "NORMAL_TEXT | TITLE | SUBTITLE | HEADING_1 .. HEADING_6" },
      direction: { type: "string", required: false, description: "LEFT_TO_RIGHT | RIGHT_TO_LEFT" },
      indentFirstLinePt: { type: "number", required: false },
      indentStartPt: { type: "number", required: false },
      indentEndPt: { type: "number", required: false },
      spaceAbovePt: { type: "number", required: false },
      spaceBelowPt: { type: "number", required: false },
      lineSpacing: { type: "number", required: false, description: "Percentage; 100 = single, 150 = 1.5x." },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ps: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      if (p.alignment)        { ps.alignment = p.alignment; fields.push("alignment"); }
      if (p.namedStyleType)   { ps.namedStyleType = p.namedStyleType; fields.push("namedStyleType"); }
      if (p.direction)        { ps.direction = p.direction; fields.push("direction"); }
      if (p.indentFirstLinePt !== undefined) { ps.indentFirstLine = pt(p.indentFirstLinePt); fields.push("indentFirstLine"); }
      if (p.indentStartPt !== undefined)     { ps.indentStart = pt(p.indentStartPt); fields.push("indentStart"); }
      if (p.indentEndPt !== undefined)       { ps.indentEnd = pt(p.indentEndPt); fields.push("indentEnd"); }
      if (p.spaceAbovePt !== undefined)      { ps.spaceAbove = pt(p.spaceAbovePt); fields.push("spaceAbove"); }
      if (p.spaceBelowPt !== undefined)      { ps.spaceBelow = pt(p.spaceBelowPt); fields.push("spaceBelow"); }
      if (p.lineSpacing !== undefined)       { ps.lineSpacing = p.lineSpacing; fields.push("lineSpacing"); }
      if (fields.length === 0) {
        throw new Error("googleDocs.document.updateParagraphStyle: at least one property required");
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateParagraphStyle: {
            range: { startIndex: p.startIndex, endIndex: p.endIndex, segmentId: p.segmentId },
            paragraphStyle: ps,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateTableCellStyle", {
    description:
      "Apply table-cell styling (background color, borders, padding) to a contiguous span of cells. Pass either a single cell via `tableStartLocation+rowIndex+columnIndex`, or a range via `tableStartLocation+rowSpan+columnSpan`.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true, description: "The startIndex of the table element." },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: false, default: 1 },
      columnSpan: { type: "number", required: false, default: 1 },
      backgroundColorHex: { type: "string", required: false },
      paddingLeftPt: { type: "number", required: false },
      paddingRightPt: { type: "number", required: false },
      paddingTopPt: { type: "number", required: false },
      paddingBottomPt: { type: "number", required: false },
      contentAlignment: { type: "string", required: false, description: "TOP | MIDDLE | BOTTOM" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      if (p.backgroundColorHex) {
        style.backgroundColor = { color: { rgbColor: hexToRgbF(p.backgroundColorHex as string) } };
        fields.push("backgroundColor");
      }
      if (p.paddingLeftPt !== undefined)   { style.paddingLeft = pt(p.paddingLeftPt); fields.push("paddingLeft"); }
      if (p.paddingRightPt !== undefined)  { style.paddingRight = pt(p.paddingRightPt); fields.push("paddingRight"); }
      if (p.paddingTopPt !== undefined)    { style.paddingTop = pt(p.paddingTopPt); fields.push("paddingTop"); }
      if (p.paddingBottomPt !== undefined) { style.paddingBottom = pt(p.paddingBottomPt); fields.push("paddingBottom"); }
      if (p.contentAlignment)              { style.contentAlignment = p.contentAlignment; fields.push("contentAlignment"); }
      if (fields.length === 0) {
        throw new Error("googleDocs.document.updateTableCellStyle: at least one style property required");
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTableCellStyle: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
                rowIndex: p.rowIndex,
                columnIndex: p.columnIndex,
              },
              rowSpan: (p.rowSpan as number | undefined) ?? 1,
              columnSpan: (p.columnSpan as number | undefined) ?? 1,
            },
            tableCellStyle: style,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });

  rl.registerAction("document.mergeTableCells", {
    description: "Merge a contiguous block of cells in a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: true },
      columnSpan: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          mergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
                rowIndex: p.rowIndex,
                columnIndex: p.columnIndex,
              },
              rowSpan: p.rowSpan,
              columnSpan: p.columnSpan,
            },
          },
        },
      ]);
    },
  });

  rl.registerAction("document.unmergeTableCells", {
    description: "Unmerge a previously merged block of cells.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: true },
      columnSpan: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          unmergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
                rowIndex: p.rowIndex,
                columnIndex: p.columnIndex,
              },
              rowSpan: p.rowSpan,
              columnSpan: p.columnSpan,
            },
          },
        },
      ]);
    },
  });

  rl.registerAction("document.insertInlineImage", {
    description: "Insert an inline image at the given location. `uri` must point to a publicly fetchable image.",
    inputSchema: {
      document: { type: "string", required: true },
      index: { type: "number", required: true },
      uri: { type: "string", required: true },
      widthPt: { type: "number", required: false },
      heightPt: { type: "number", required: false },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      const req: Record<string, unknown> = {
        location: buildLocation(p.index as number, p.segmentId as string | undefined),
        uri: p.uri,
      };
      if (p.widthPt !== undefined || p.heightPt !== undefined) {
        req.objectSize = {};
        if (p.widthPt !== undefined) (req.objectSize as Record<string, unknown>).width = pt(p.widthPt);
        if (p.heightPt !== undefined) (req.objectSize as Record<string, unknown>).height = pt(p.heightPt);
      }
      return runBatchUpdate(ctx, documentId, [{ insertInlineImage: req }]);
    },
  });

  rl.registerAction("document.replaceImage", {
    description: "Replace an existing image (identified by its inline-object id) with a new image from a publicly fetchable URI.",
    inputSchema: {
      document: { type: "string", required: true },
      imageObjectId: { type: "string", required: true },
      uri: { type: "string", required: true },
      imageReplaceMethod: { type: "string", required: false, description: "CENTER_CROP (default) | (others as Docs API adds them)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          replaceImage: {
            imageObjectId: p.imageObjectId,
            uri: p.uri,
            imageReplaceMethod: (p.imageReplaceMethod as string | undefined) ?? "CENTER_CROP",
          },
        },
      ]);
    },
  });

  rl.registerAction("document.insertSectionBreak", {
    description: "Insert a section break at the given location.",
    inputSchema: {
      document: { type: "string", required: true },
      index: { type: "number", required: true },
      sectionType: { type: "string", required: false, description: "CONTINUOUS | NEXT_PAGE. Default CONTINUOUS." },
      segmentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          insertSectionBreak: {
            location: buildLocation(p.index as number, p.segmentId as string | undefined),
            sectionType: (p.sectionType as string | undefined) ?? "CONTINUOUS",
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateDocumentStyle", {
    description: "Update document-level style (page size, margins, page numbers, default direction).",
    inputSchema: {
      document: { type: "string", required: true },
      pageMarginTopPt: { type: "number", required: false },
      pageMarginBottomPt: { type: "number", required: false },
      pageMarginLeftPt: { type: "number", required: false },
      pageMarginRightPt: { type: "number", required: false },
      pageSizeWidthPt: { type: "number", required: false },
      pageSizeHeightPt: { type: "number", required: false },
      useCustomHeaderFooterMargins: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ds: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      if (p.pageMarginTopPt !== undefined)    { ds.marginTop = pt(p.pageMarginTopPt); fields.push("marginTop"); }
      if (p.pageMarginBottomPt !== undefined) { ds.marginBottom = pt(p.pageMarginBottomPt); fields.push("marginBottom"); }
      if (p.pageMarginLeftPt !== undefined)   { ds.marginLeft = pt(p.pageMarginLeftPt); fields.push("marginLeft"); }
      if (p.pageMarginRightPt !== undefined)  { ds.marginRight = pt(p.pageMarginRightPt); fields.push("marginRight"); }
      if (p.pageSizeWidthPt !== undefined || p.pageSizeHeightPt !== undefined) {
        ds.pageSize = {};
        if (p.pageSizeWidthPt !== undefined)  (ds.pageSize as Record<string, unknown>).width = pt(p.pageSizeWidthPt);
        if (p.pageSizeHeightPt !== undefined) (ds.pageSize as Record<string, unknown>).height = pt(p.pageSizeHeightPt);
        fields.push("pageSize");
      }
      if (p.useCustomHeaderFooterMargins !== undefined) {
        ds.useCustomHeaderFooterMargins = p.useCustomHeaderFooterMargins;
        fields.push("useCustomHeaderFooterMargins");
      }
      if (fields.length === 0) {
        throw new Error("googleDocs.document.updateDocumentStyle: pass at least one property");
      }
      return runBatchUpdate(ctx, documentId, [{ updateDocumentStyle: { documentStyle: ds, fields: fields.join(",") } }]);
    },
  });

  // ─── Small helper for Docs additions ────────────────────────────
  // (declared at the bottom so it doesn't conflict with the
  // upstream module-scope `hexToRgb` if one is added later)

}
