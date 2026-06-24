import type { RunlinePluginAPI } from "runline";
import {
  buildLocation,
  extractDocumentId,
  location,
  runBatchUpdate,
} from "./shared.js";

export function registerStructureActions(rl: RunlinePluginAPI) {
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
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        insertPageBreak: buildLocation(
          kind,
          p.segmentId as string,
          p.index as number
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        createNamedRange: {
          name: p.name,
          range: {
            segmentId: seg,
            startIndex: p.startIndex,
            endIndex: p.endIndex,
          },
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
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = { segmentId: seg };
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
        deleteHeader: { headerId: p.headerId },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      const sectionBreakLocation: Record<string, unknown> = { segmentId: seg };
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
        deleteFooter: { footerId: p.footerId },
      });
    },
  });

  rl.registerAction("document.deletePositionedObject", {
    description:
      "Delete a positioned object (inline image, floating image, etc.) by its objectId.",
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          insertSectionBreak: {
            location: location(
              p.index as number,
              p.segmentId as string | undefined
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
          updateDocumentStyle: { documentStyle: ds, fields: fields.join(",") },
        },
      ]);
    },
  });
}
