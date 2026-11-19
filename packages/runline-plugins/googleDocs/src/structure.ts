import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { atLeastOne, exactlyOne, STRICT } from "../../_shared/schemas.js";
import {
  buildLocation,
  compact,
  DocumentInput,
  extractDocumentId,
  LOCATION_REQUIREMENT,
  LocationInput,
  location,
  type Place,
  PositivePoints,
  points,
  RangeInput,
  range,
  runBatchUpdate,
  SegmentInput,
  segment,
} from "./shared.js";

/**
 * The section break a header or footer attaches to: the one at `index`,
 * or the segment's own when the location is its end.
 */
function sectionBreakLocation(p: Place): Record<string, unknown> {
  return compact({
    segmentId: segment(p.segmentId),
    tabId: p.tabId,
    index: p.locationKind === "endOfSegmentLocation" ? undefined : p.index,
  });
}

export function registerStructureActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertPageBreak", {
    access: "write",
    description: "Insert a page break at an index or at the end of a segment.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        insertPageBreak: buildLocation(p),
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        createNamedRange: {
          name: p.name,
          range: range(p),
        },
      });
    },
  });

  const namedRangeTarget = {
    namedRangeId: t.Optional(t.String({ minLength: 1 })),
    name: t.Optional(t.String({ minLength: 1 })),
  };
  rl.registerAction("document.deleteNamedRange", {
    access: "write",
    description:
      "Delete named range(s). Pass one of `namedRangeId` or `name`; the latter deletes every range sharing that name.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...namedRangeTarget,
        tabIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        ),
      },
      {
        ...STRICT,
        ...exactlyOne(namedRangeTarget),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const req: Record<string, unknown> = p.namedRangeId
        ? { namedRangeId: p.namedRangeId }
        : { name: p.name };
      if (p.tabIds) req.tabsCriteria = { tabIds: p.tabIds };
      return runBatchUpdate(ctx, documentId, { deleteNamedRange: req });
    },
  });

  rl.registerAction("document.createHeader", {
    access: "write",
    description: "Create a DEFAULT header attached to a SectionBreak.",
    inputSchema: t.Object(
      { ...DocumentInput, ...LocationInput },
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        createHeader: {
          type: "DEFAULT",
          sectionBreakLocation: sectionBreakLocation(p),
        },
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        createFooter: {
          type: "DEFAULT",
          sectionBreakLocation: sectionBreakLocation(p),
        },
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        createFootnote: buildLocation(p),
      });
    },
  });

  const replacedRange = {
    namedRangeId: t.Optional(t.String({ minLength: 1 })),
    namedRangeName: t.Optional(t.String({ minLength: 1 })),
  };
  rl.registerAction("document.replaceNamedRangeContent", {
    access: "write",
    description:
      "Replace the content of a named range by ID or name with text.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        text: t.String(),
        ...replacedRange,
        tabIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        ),
      },
      {
        ...STRICT,
        ...exactlyOne(replacedRange),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        replaceNamedRangeContent: compact({
          text: p.text,
          namedRangeId: p.namedRangeId,
          namedRangeName: p.namedRangeName,
          tabsCriteria: p.tabIds ? { tabIds: p.tabIds } : undefined,
        }),
      });
    },
  });

  const sectionStyleFields = {
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
  };
  rl.registerAction("document.updateSectionStyle", {
    access: "write",
    description:
      "Update section style over a range, such as margins or column properties.",
    inputSchema: t.Object(
      { ...DocumentInput, ...RangeInput, ...sectionStyleFields },
      {
        ...STRICT,
        ...atLeastOne(sectionStyleFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const sectionStyle: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.marginTopPt !== undefined) {
        sectionStyle.marginTop = points(p.marginTopPt);
        fields.push("marginTop");
      }
      if (p.marginBottomPt !== undefined) {
        sectionStyle.marginBottom = points(p.marginBottomPt);
        fields.push("marginBottom");
      }
      if (p.marginLeftPt !== undefined) {
        sectionStyle.marginLeft = points(p.marginLeftPt);
        fields.push("marginLeft");
      }
      if (p.marginRightPt !== undefined) {
        sectionStyle.marginRight = points(p.marginRightPt);
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
      const mask = p.fields ?? fields.join(",");
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, [
        {
          insertSectionBreak: {
            location: location(p.index, p.segmentId, p.tabId),
            sectionType: p.sectionType ?? "CONTINUOUS",
          },
        },
      ]);
    },
  });

  const documentStyleFields = {
    pageMarginTopPt: t.Optional(PositivePoints),
    pageMarginBottomPt: t.Optional(PositivePoints),
    pageMarginLeftPt: t.Optional(PositivePoints),
    pageMarginRightPt: t.Optional(PositivePoints),
    pageSizeWidthPt: t.Optional(PositivePoints),
    pageSizeHeightPt: t.Optional(PositivePoints),
    useCustomHeaderFooterMargins: t.Optional(t.Boolean()),
  };
  rl.registerAction("document.updateDocumentStyle", {
    access: "write",
    description:
      "Update document-level style (page size, margins, page numbers, default direction).",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        tabId: t.Optional(t.String({ minLength: 1 })),
        ...documentStyleFields,
      },
      {
        ...STRICT,
        ...atLeastOne(documentStyleFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const ds: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.pageMarginTopPt !== undefined) {
        ds.marginTop = points(p.pageMarginTopPt);
        fields.push("marginTop");
      }
      if (p.pageMarginBottomPt !== undefined) {
        ds.marginBottom = points(p.pageMarginBottomPt);
        fields.push("marginBottom");
      }
      if (p.pageMarginLeftPt !== undefined) {
        ds.marginLeft = points(p.pageMarginLeftPt);
        fields.push("marginLeft");
      }
      if (p.pageMarginRightPt !== undefined) {
        ds.marginRight = points(p.pageMarginRightPt);
        fields.push("marginRight");
      }
      if (p.pageSizeWidthPt !== undefined || p.pageSizeHeightPt !== undefined) {
        ds.pageSize = {};
        if (p.pageSizeWidthPt !== undefined)
          (ds.pageSize as Record<string, unknown>).width = points(
            p.pageSizeWidthPt,
          );
        if (p.pageSizeHeightPt !== undefined)
          (ds.pageSize as Record<string, unknown>).height = points(
            p.pageSizeHeightPt,
          );
        fields.push("pageSize");
      }
      if (p.useCustomHeaderFooterMargins !== undefined) {
        ds.useCustomHeaderFooterMargins = p.useCustomHeaderFooterMargins;
        fields.push("useCustomHeaderFooterMargins");
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
