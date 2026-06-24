import type { RunlinePluginAPI } from "runline";
import {
  DRIVE_BASE,
  docsRequest,
  extractDocumentId,
  flattenBodyText,
} from "./shared.js";

export function registerDocumentsActions(rl: RunlinePluginAPI) {
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
      document: {
        type: "string",
        required: true,
        description: "Document ID or URL",
      },
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
        qs
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
      return docsRequest(
        ctx,
        "POST",
        `/documents/${documentId}:batchUpdate`,
        body
      );
    },
  });
}
