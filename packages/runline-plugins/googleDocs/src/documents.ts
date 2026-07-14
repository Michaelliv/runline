import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  DocumentInput,
  DRIVE_BASE,
  docsRequest,
  extractDocumentId,
  flattenBodyText,
  RawGoogleObject,
  STRICT_OBJECT,
  WriteControl,
} from "./shared.js";

export function registerDocumentsActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.create", {
    access: "write",
    description:
      "Create a new Google Doc, optionally in a specific Drive folder (goes through the Drive API; needs drive.file scope).",
    inputSchema: t.Object(
      {
        title: t.String({ minLength: 1 }),
        folderId: t.Optional(
          t.String({
            minLength: 1,
            description:
              "Parent folder in Drive. Omit to place in My Drive root.",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
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

  rl.registerAction("document.createBlank", {
    access: "write",
    description:
      "Create a blank Google Doc through the native Docs API. Use document.create when you need Drive folder placement.",
    inputSchema: t.Object({ title: t.String({ minLength: 1 }) }, STRICT_OBJECT),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return docsRequest(ctx, "POST", "/documents", { title: p.title });
    },
  });

  rl.registerAction("document.get", {
    access: "read",
    description:
      "Get a document. Accepts a bare ID or a docs.google.com URL. `simple=true` collapses the body to plain text.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        simple: t.Optional(t.Boolean()),
        suggestionsViewMode: t.Optional(
          t.Union([
            t.Literal("DEFAULT_FOR_CURRENT_ACCESS"),
            t.Literal("SUGGESTIONS_INLINE"),
            t.Literal("PREVIEW_SUGGESTIONS_ACCEPTED"),
            t.Literal("PREVIEW_WITHOUT_SUGGESTIONS"),
          ]),
        ),
        includeTabsContent: t.Optional(
          t.Boolean({
            description:
              "Return content for all tabs instead of only first-tab legacy fields.",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const qs: Record<string, unknown> = {};
      if (p.suggestionsViewMode) qs.suggestionsViewMode = p.suggestionsViewMode;
      if (p.includeTabsContent !== undefined)
        qs.includeTabsContent = p.includeTabsContent;
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
    access: "write",
    description:
      "Raw passthrough to documents.batchUpdate — pass a full `requests` array for atomic multi-edit operations.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        requests: t.Array(RawGoogleObject, { minItems: 1 }),
        writeControl: t.Optional(WriteControl),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const body: Record<string, unknown> = {
        requests: p.requests,
      };
      if (p.writeControl) body.writeControl = p.writeControl;
      return docsRequest(
        ctx,
        "POST",
        `/documents/${documentId}:batchUpdate`,
        body,
      );
    },
  });
}
