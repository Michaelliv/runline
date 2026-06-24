import type { RunlinePluginAPI } from "runline";
import {
  buildLocation,
  compact,
  extractDocumentId,
  location,
  runBatchUpdate,
} from "./shared.js";

function range(p: Record<string, unknown>): Record<string, unknown> {
  return compact({
    segmentId: p.segmentId && p.segmentId !== "body" ? p.segmentId : "",
    startIndex: p.startIndex,
    endIndex: p.endIndex,
    tabId: p.tabId,
  });
}

function point(value: unknown): Record<string, unknown> {
  return { magnitude: value, unit: "PT" };
}

export function registerStructureActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertPageBreak", {
    description: "Insert a page break at an index or at the end of a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        insertPageBreak: buildLocation(
          kind,
          p.segmentId as string,
          p.index as number,
          p.tabId as string | undefined
        ),
      });
    },
  });

  rl.registerAction("document.createNamedRange", {
    description:
      "Create a named range over a span of text (useful for later programmatic edits).",
    inputSchema: {
      document: { type: "string", required: true },
      name: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        createNamedRange: {
          name: p.name,
          range: range(p),
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
      tabIds: {
        type: "array",
        required: false,
        description: "Optional tab IDs for tabsCriteria.",
      },
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
      if (Array.isArray(p.tabIds)) req.tabsCriteria = { tabIds: p.tabIds };
      return runBatchUpdate(ctx, documentId, { deleteNamedRange: req });
    },
  });

  rl.registerAction("document.createHeader", {
    description: "Create a DEFAULT header attached to a SectionBreak.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = compact({
        segmentId: seg,
        tabId: p.tabId,
      });
      if (kind === "location") {
        if (p.index === undefined) {
          throw new Error(
            "googleDocs: `index` is required when locationKind=location"
          );
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
      return runBatchUpdate(ctx, documentId, {
        deleteHeader: compact({ headerId: p.headerId, tabId: p.tabId }),
      });
    },
  });

  rl.registerAction("document.createFooter", {
    description: "Create a DEFAULT footer attached to a SectionBreak.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: { type: "string", required: false },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = compact({
        segmentId: seg,
        tabId: p.tabId,
      });
      if (kind === "location") {
        if (p.index === undefined) {
          throw new Error(
            "googleDocs: `index` is required when locationKind=location"
          );
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
      return runBatchUpdate(ctx, documentId, {
        deleteFooter: compact({ footerId: p.footerId, tabId: p.tabId }),
      });
    },
  });

  rl.registerAction("document.deletePositionedObject", {
    description:
      "Delete a positioned object (inline image, floating image, etc.) by its objectId.",
    inputSchema: {
      document: { type: "string", required: true },
      objectId: { type: "string", required: true },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deletePositionedObject: compact({
          objectId: p.objectId,
          tabId: p.tabId,
        }),
      });
    },
  });

  rl.registerAction("document.createFootnote", {
    description:
      "Create a footnote reference at a location or at the end of the document body.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: {
        type: "string",
        required: false,
        description:
          "location (default; requires index) | endOfSegmentLocation",
      },
      index: { type: "number", required: false },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        createFootnote: buildLocation(
          kind,
          p.segmentId as string,
          p.index as number,
          p.tabId as string | undefined
        ),
      });
    },
  });

  rl.registerAction("document.replaceNamedRangeContent", {
    description:
      "Replace the content of a named range by ID or name with text.",
    inputSchema: {
      document: { type: "string", required: true },
      text: { type: "string", required: true },
      namedRangeId: { type: "string", required: false },
      namedRangeName: { type: "string", required: false },
      tabIds: {
        type: "array",
        required: false,
        description: "Optional tab IDs for tabsCriteria.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      if (!p.namedRangeId && !p.namedRangeName) {
        throw new Error("googleDocs: provide namedRangeId or namedRangeName");
      }
      return runBatchUpdate(ctx, documentId, {
        replaceNamedRangeContent: compact({
          text: p.text,
          namedRangeId: p.namedRangeId,
          namedRangeName: p.namedRangeName,
          tabsCriteria: Array.isArray(p.tabIds)
            ? { tabIds: p.tabIds }
            : undefined,
        }),
      });
    },
  });

  rl.registerAction("document.updateSectionStyle", {
    description:
      "Update section style over a range, such as margins or column properties.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      marginTopPt: { type: "number", required: false },
      marginBottomPt: { type: "number", required: false },
      marginLeftPt: { type: "number", required: false },
      marginRightPt: { type: "number", required: false },
      columnSeparatorStyle: {
        type: "string",
        required: false,
        description: "NONE | BETWEEN_EACH_COLUMN",
      },
      contentDirection: {
        type: "string",
        required: false,
        description: "LEFT_TO_RIGHT | RIGHT_TO_LEFT",
      },
      fields: {
        type: "string",
        required: false,
        description:
          "Field mask. Defaults to fields implied by supplied properties.",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const sectionStyle: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.marginTopPt !== undefined) {
        sectionStyle.marginTop = point(p.marginTopPt);
        fields.push("marginTop");
      }
      if (p.marginBottomPt !== undefined) {
        sectionStyle.marginBottom = point(p.marginBottomPt);
        fields.push("marginBottom");
      }
      if (p.marginLeftPt !== undefined) {
        sectionStyle.marginLeft = point(p.marginLeftPt);
        fields.push("marginLeft");
      }
      if (p.marginRightPt !== undefined) {
        sectionStyle.marginRight = point(p.marginRightPt);
        fields.push("marginRight");
      }
      if (p.columnSeparatorStyle) {
        sectionStyle.columnSeparatorStyle = p.columnSeparatorStyle;
        fields.push("columnSeparatorStyle");
      }
      if (p.contentDirection) {
        sectionStyle.contentDirection = p.contentDirection;
        fields.push("contentDirection");
      }
      const mask = (p.fields as string | undefined) ?? fields.join(",");
      if (!mask)
        throw new Error(
          "googleDocs.document.updateSectionStyle: fields or section style property required"
        );
      return runBatchUpdate(ctx, documentId, {
        updateSectionStyle: {
          range: range(p),
          sectionStyle,
          fields: mask,
        },
      });
    },
  });

  rl.registerAction("document.insertSectionBreak", {
    description: "Insert a section break at the given location.",
    inputSchema: {
      document: { type: "string", required: true },
      index: { type: "number", required: true },
      sectionType: {
        type: "string",
        required: false,
        description: "CONTINUOUS | NEXT_PAGE. Default CONTINUOUS.",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          insertSectionBreak: {
            location: location(
              p.index as number,
              p.segmentId as string | undefined,
              p.tabId as string | undefined
            ),
            sectionType: (p.sectionType as string | undefined) ?? "CONTINUOUS",
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateDocumentStyle", {
    description:
      "Update document-level style (page size, margins, page numbers, default direction).",
    inputSchema: {
      document: { type: "string", required: true },
      pageMarginTopPt: { type: "number", required: false },
      pageMarginBottomPt: { type: "number", required: false },
      pageMarginLeftPt: { type: "number", required: false },
      pageMarginRightPt: { type: "number", required: false },
      pageSizeWidthPt: { type: "number", required: false },
      pageSizeHeightPt: { type: "number", required: false },
      useCustomHeaderFooterMargins: { type: "boolean", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ds: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      if (p.pageMarginTopPt !== undefined) {
        ds.marginTop = pt(p.pageMarginTopPt);
        fields.push("marginTop");
      }
      if (p.pageMarginBottomPt !== undefined) {
        ds.marginBottom = pt(p.pageMarginBottomPt);
        fields.push("marginBottom");
      }
      if (p.pageMarginLeftPt !== undefined) {
        ds.marginLeft = pt(p.pageMarginLeftPt);
        fields.push("marginLeft");
      }
      if (p.pageMarginRightPt !== undefined) {
        ds.marginRight = pt(p.pageMarginRightPt);
        fields.push("marginRight");
      }
      if (p.pageSizeWidthPt !== undefined || p.pageSizeHeightPt !== undefined) {
        ds.pageSize = {};
        if (p.pageSizeWidthPt !== undefined)
          (ds.pageSize as Record<string, unknown>).width = pt(
            p.pageSizeWidthPt
          );
        if (p.pageSizeHeightPt !== undefined)
          (ds.pageSize as Record<string, unknown>).height = pt(
            p.pageSizeHeightPt
          );
        fields.push("pageSize");
      }
      if (p.useCustomHeaderFooterMargins !== undefined) {
        ds.useCustomHeaderFooterMargins = p.useCustomHeaderFooterMargins;
        fields.push("useCustomHeaderFooterMargins");
      }
      if (fields.length === 0) {
        throw new Error(
          "googleDocs.document.updateDocumentStyle: pass at least one property"
        );
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateDocumentStyle: compact({
            documentStyle: ds,
            fields: fields.join(","),
            tabId: p.tabId,
          }),
        },
      ]);
    },
  });
}
