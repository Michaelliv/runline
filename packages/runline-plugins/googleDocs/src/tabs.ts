import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { atLeastOne, STRICT } from "../../_shared/schemas.js";
import {
  compact,
  DocumentInput,
  extractDocumentId,
  runBatchUpdate,
} from "./shared.js";

function tabProperties(p: {
  tabId?: string;
  title?: string;
  index?: number;
  parentTabId?: string;
}): Record<string, unknown> {
  return compact({
    tabId: p.tabId,
    title: p.title,
    index: p.index,
    parentTabId: p.parentTabId,
  });
}

export function registerTabActions(rl: RunlinePluginAPI) {
  /** What a tab is given on creating it, and what an update may change. */
  const tabChanges = {
    title: t.Optional(t.String({ minLength: 1 })),
    index: t.Optional(t.Integer({ minimum: 0 })),
    parentTabId: t.Optional(t.String({ minLength: 1 })),
  };
  rl.registerAction("document.addDocumentTab", {
    access: "write",
    description:
      "Add a Google Docs document tab, optionally at an index or under a parent tab.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...tabChanges,
      },
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
        fields: t.Optional(t.String({ minLength: 1 })),
        ...tabChanges,
      },
      {
        ...STRICT,
        ...atLeastOne(tabChanges),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const fields: string[] = [];
      if (p.title !== undefined) fields.push("title");
      if (p.index !== undefined) fields.push("index");
      if (p.parentTabId !== undefined) fields.push("parentTabId");
      const mask = p.fields ?? fields.join(",");
      return runBatchUpdate(ctx, documentId, {
        updateDocumentTabProperties: {
          tabProperties: tabProperties(p),
          fields: mask,
        },
      });
    },
  });
}
