import type { RunlinePluginAPI } from "runline";
import { compact, extractDocumentId, runBatchUpdate } from "./shared.js";

function tabProperties(p: Record<string, unknown>): Record<string, unknown> {
  return compact({
    tabId: p.tabId,
    title: p.title,
    index: p.index,
    parentTabId: p.parentTabId,
  });
}

export function registerTabActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.addDocumentTab", {
    description:
      "Add a Google Docs document tab, optionally at an index or under a parent tab.",
    inputSchema: {
      document: { type: "string", required: true },
      title: { type: "string", required: false },
      index: { type: "number", required: false },
      parentTabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        addDocumentTab: { tabProperties: tabProperties(p) },
      });
    },
  });

  rl.registerAction("document.deleteTab", {
    description:
      "Delete a Google Docs document tab by tab ID. Child tabs are deleted too.",
    inputSchema: {
      document: { type: "string", required: true },
      tabId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteTab: { tabId: p.tabId },
      });
    },
  });

  rl.registerAction("document.updateDocumentTabProperties", {
    description:
      "Update Google Docs tab properties such as title, index, or parent tab.",
    inputSchema: {
      document: { type: "string", required: true },
      tabId: { type: "string", required: true },
      title: { type: "string", required: false },
      index: { type: "number", required: false },
      parentTabId: { type: "string", required: false },
      fields: {
        type: "string",
        required: false,
        description:
          "Field mask. Defaults to fields implied by supplied properties.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const fields: string[] = [];
      if (p.title !== undefined) fields.push("title");
      if (p.index !== undefined) fields.push("index");
      if (p.parentTabId !== undefined) fields.push("parentTabId");
      const mask = (p.fields as string | undefined) ?? fields.join(",");
      if (!mask) {
        throw new Error(
          "googleDocs.document.updateDocumentTabProperties: fields or tab property required",
        );
      }
      return runBatchUpdate(ctx, documentId, {
        updateDocumentTabProperties: {
          tabProperties: tabProperties(p),
          fields: mask,
        },
      });
    },
  });
}
