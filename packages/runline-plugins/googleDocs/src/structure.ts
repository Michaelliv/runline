import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  buildLocation,
  compact,
  DocumentInput,
  extractDocumentId,
  LOCATION_REQUIREMENT,
  LocationInput,
  location,
  PositivePoints,
  RangeInput,
  runBatchUpdate,
  SegmentInput,
  STRICT_OBJECT,
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
    access: "write",
    description: "Insert a page break at an index or at the end of a segment.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
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
          p.tabId as string | undefined,
        ),
      });
    },
  });

  rl.registerAction("document.createNamedRange", {
    access: "write",
    description:
      "Create a named range over a span of text (useful for later programmatic edits).",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        name: t.String({ minLength: 1 }),
        ...RangeInput,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        createNamedRange: {
          name: p.name,
          range: range(p),
        },
      });
    },
  });

  rl.registerAction("document.deleteNamedRange", {
    access: "write",
    description:
      "Delete named range(s). Pass one of `namedRangeId` or `name`; the latter deletes every range sharing that name.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        namedRangeId: t.Optional(t.String({ minLength: 1 })),
        name: t.Optional(t.String({ minLength: 1 })),
        tabIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        ),
      },
      {
        ...STRICT_OBJECT,
        oneOf: [{ required: ["namedRangeId"] }, { required: ["name"] }],
      },
    ),
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
    access: "write",
    description: "Create a DEFAULT header attached to a SectionBreak.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
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
            "googleDocs: `index` is required when locationKind=location",
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
    access: "write",
    description: "Delete a header by ID.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        headerId: t.String({ minLength: 1 }),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteHeader: compact({ headerId: p.headerId, tabId: p.tabId }),
      });
    },
  });

  rl.registerAction("document.createFooter", {
    access: "write",
    description: "Create a DEFAULT footer attached to a SectionBreak.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
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
            "googleDocs: `index` is required when locationKind=location",
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
    access: "write",
    description: "Delete a footer by ID.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        footerId: t.String({ minLength: 1 }),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteFooter: compact({ footerId: p.footerId, tabId: p.tabId }),
      });
    },
  });

  rl.registerAction("document.deletePositionedObject", {
    access: "write",
    description:
      "Delete a positioned object (inline image, floating image, etc.) by its objectId.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        objectId: t.String({ minLength: 1 }),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT_OBJECT,
    ),
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
    access: "write",
    description:
      "Create a footnote reference at a location or at the end of the document body.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
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
          p.tabId as string | undefined,
        ),
      });
    },
  });

  rl.registerAction("document.replaceNamedRangeContent", {
    access: "write",
    description:
      "Replace the content of a named range by ID or name with text.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        text: t.String(),
        namedRangeId: t.Optional(t.String({ minLength: 1 })),
        namedRangeName: t.Optional(t.String({ minLength: 1 })),
        tabIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        ),
      },
      {
        ...STRICT_OBJECT,
        oneOf: [
          { required: ["namedRangeId"] },
          { required: ["namedRangeName"] },
        ],
      },
    ),
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
    access: "write",
    description:
      "Update section style over a range, such as margins or column properties.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...RangeInput,
        marginTopPt: t.Optional(PositivePoints),
        marginBottomPt: t.Optional(PositivePoints),
        marginLeftPt: t.Optional(PositivePoints),
        marginRightPt: t.Optional(PositivePoints),
        columnSeparatorStyle: t.Optional(
          t.Union([t.Literal("NONE"), t.Literal("BETWEEN_EACH_COLUMN")]),
        ),
        contentDirection: t.Optional(
          t.Union([t.Literal("LEFT_TO_RIGHT"), t.Literal("RIGHT_TO_LEFT")]),
        ),
        fields: t.Optional(t.String({ minLength: 1 })),
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["marginTopPt"] },
          { required: ["marginBottomPt"] },
          { required: ["marginLeftPt"] },
          { required: ["marginRightPt"] },
          { required: ["columnSeparatorStyle"] },
          { required: ["contentDirection"] },
          { required: ["fields"] },
        ],
      },
    ),
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
          "googleDocs.document.updateSectionStyle: fields or section style property required",
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
    access: "write",
    description: "Insert a section break at the given location.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        index: t.Integer({ minimum: 0 }),
        sectionType: t.Optional(
          t.Union([t.Literal("CONTINUOUS"), t.Literal("NEXT_PAGE")]),
        ),
        ...SegmentInput,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          insertSectionBreak: {
            location: location(
              p.index as number,
              p.segmentId as string | undefined,
              p.tabId as string | undefined,
            ),
            sectionType: (p.sectionType as string | undefined) ?? "CONTINUOUS",
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateDocumentStyle", {
    access: "write",
    description:
      "Update document-level style (page size, margins, page numbers, default direction).",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        pageMarginTopPt: t.Optional(PositivePoints),
        pageMarginBottomPt: t.Optional(PositivePoints),
        pageMarginLeftPt: t.Optional(PositivePoints),
        pageMarginRightPt: t.Optional(PositivePoints),
        pageSizeWidthPt: t.Optional(PositivePoints),
        pageSizeHeightPt: t.Optional(PositivePoints),
        useCustomHeaderFooterMargins: t.Optional(t.Boolean()),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["pageMarginTopPt"] },
          { required: ["pageMarginBottomPt"] },
          { required: ["pageMarginLeftPt"] },
          { required: ["pageMarginRightPt"] },
          { required: ["pageSizeWidthPt"] },
          { required: ["pageSizeHeightPt"] },
          { required: ["useCustomHeaderFooterMargins"] },
        ],
      },
    ),
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
            p.pageSizeWidthPt,
          );
        if (p.pageSizeHeightPt !== undefined)
          (ds.pageSize as Record<string, unknown>).height = pt(
            p.pageSizeHeightPt,
          );
        fields.push("pageSize");
      }
      if (p.useCustomHeaderFooterMargins !== undefined) {
        ds.useCustomHeaderFooterMargins = p.useCustomHeaderFooterMargins;
        fields.push("useCustomHeaderFooterMargins");
      }
      if (fields.length === 0) {
        throw new Error(
          "googleDocs.document.updateDocumentStyle: pass at least one property",
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
