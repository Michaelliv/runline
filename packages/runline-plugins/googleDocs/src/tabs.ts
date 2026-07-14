import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  compact,
  DocumentInput,
  extractDocumentId,
  runBatchUpdate,
  STRICT_OBJECT,
} from "./shared.js";

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
    access: "write",
    description:
      "Add a Google Docs document tab, optionally at an index or under a parent tab.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        title: t.Optional(t.String({ minLength: 1 })),
        index: t.Optional(t.Integer({ minimum: 0 })),
        parentTabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        addDocumentTab: { tabProperties: tabProperties(p) },
      });
    },
  });

  rl.registerAction("document.deleteTab", {
    access: "write",
    description:
      "Delete a Google Docs document tab by tab ID. Child tabs are deleted too.",
    inputSchema: t.Object(
      { ...DocumentInput, tabId: t.String({ minLength: 1 }) },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteTab: { tabId: p.tabId },
      });
    },
  });

  rl.registerAction("document.updateDocumentTabProperties", {
    access: "write",
    description:
      "Update Google Docs tab properties such as title, index, or parent tab.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        tabId: t.String({ minLength: 1 }),
        title: t.Optional(t.String({ minLength: 1 })),
        index: t.Optional(t.Integer({ minimum: 0 })),
        parentTabId: t.Optional(t.String({ minLength: 1 })),
        fields: t.Optional(t.String({ minLength: 1 })),
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["title"] },
          { required: ["index"] },
          { required: ["parentTabId"] },
        ],
      },
    ),
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
