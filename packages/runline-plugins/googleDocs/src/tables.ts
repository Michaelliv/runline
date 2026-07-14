import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  buildLocation,
  compact,
  DocumentInput,
  extractDocumentId,
  HexColor,
  hexToRgbF,
  LOCATION_REQUIREMENT,
  LocationInput,
  location,
  PositivePoints,
  runBatchUpdate,
  SegmentInput,
  STRICT_OBJECT,
  TableLocationInput,
} from "./shared.js";

const PositiveSpan = t.Integer({ minimum: 1 });

function tableStartLocation(
  p: Record<string, unknown>,
): Record<string, unknown> {
  return location(
    p.tableStartIndex as number,
    p.segmentId as string | undefined,
    p.tabId as string | undefined,
  );
}

function tableCellLocation(
  p: Record<string, unknown>,
): Record<string, unknown> {
  return {
    rowIndex: p.rowIndex,
    columnIndex: p.columnIndex,
    tableStartLocation: tableStartLocation(p),
  };
}

function point(value: unknown): Record<string, unknown> {
  return { magnitude: value, unit: "PT" };
}

export function registerTablesActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertTable", {
    access: "write",
    description: "Insert an empty table with the given dimensions.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        rows: PositiveSpan,
        columns: PositiveSpan,
        ...LocationInput,
      },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      return runBatchUpdate(ctx, documentId, {
        insertTable: {
          rows: p.rows,
          columns: p.columns,
          ...buildLocation(
            kind,
            p.segmentId as string,
            p.index as number,
            p.tabId as string | undefined,
          ),
        },
      });
    },
  });

  rl.registerAction("document.insertTableRow", {
    access: "write",
    description:
      "Insert a table row above or below a cell in an existing table.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...TableLocationInput,
        insertBelow: t.Optional(t.Boolean()),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        insertTableRow: {
          insertBelow: p.insertBelow === true,
          tableCellLocation: tableCellLocation(p),
        },
      });
    },
  });

  rl.registerAction("document.deleteTableRow", {
    access: "write",
    description: "Delete a specific row from a table.",
    inputSchema: t.Object(
      { ...DocumentInput, ...TableLocationInput },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteTableRow: {
          tableCellLocation: tableCellLocation(p),
        },
      });
    },
  });

  rl.registerAction("document.insertTableColumn", {
    access: "write",
    description: "Insert a column left or right of a cell.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...TableLocationInput,
        insertRight: t.Optional(t.Boolean()),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        insertTableColumn: {
          insertRight: p.insertRight === true,
          tableCellLocation: tableCellLocation(p),
        },
      });
    },
  });

  rl.registerAction("document.deleteTableColumn", {
    access: "write",
    description: "Delete a specific column from a table.",
    inputSchema: t.Object(
      { ...DocumentInput, ...TableLocationInput },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteTableColumn: {
          tableCellLocation: tableCellLocation(p),
        },
      });
    },
  });

  rl.registerAction("document.updateTableCellStyle", {
    access: "write",
    description:
      "Apply table-cell styling (background color, borders, padding) to a contiguous span of cells. Pass either a single cell via `tableStartLocation+rowIndex+columnIndex`, or a range via `tableStartLocation+rowSpan+columnSpan`.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...TableLocationInput,
        rowSpan: t.Optional(PositiveSpan),
        columnSpan: t.Optional(PositiveSpan),
        backgroundColorHex: t.Optional(HexColor),
        paddingLeftPt: t.Optional(PositivePoints),
        paddingRightPt: t.Optional(PositivePoints),
        paddingTopPt: t.Optional(PositivePoints),
        paddingBottomPt: t.Optional(PositivePoints),
        contentAlignment: t.Optional(
          t.Union([t.Literal("TOP"), t.Literal("MIDDLE"), t.Literal("BOTTOM")]),
        ),
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["backgroundColorHex"] },
          { required: ["paddingLeftPt"] },
          { required: ["paddingRightPt"] },
          { required: ["paddingTopPt"] },
          { required: ["paddingBottomPt"] },
          { required: ["contentAlignment"] },
        ],
      },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      if (p.backgroundColorHex) {
        style.backgroundColor = {
          color: { rgbColor: hexToRgbF(p.backgroundColorHex as string) },
        };
        fields.push("backgroundColor");
      }
      if (p.paddingLeftPt !== undefined) {
        style.paddingLeft = pt(p.paddingLeftPt);
        fields.push("paddingLeft");
      }
      if (p.paddingRightPt !== undefined) {
        style.paddingRight = pt(p.paddingRightPt);
        fields.push("paddingRight");
      }
      if (p.paddingTopPt !== undefined) {
        style.paddingTop = pt(p.paddingTopPt);
        fields.push("paddingTop");
      }
      if (p.paddingBottomPt !== undefined) {
        style.paddingBottom = pt(p.paddingBottomPt);
        fields.push("paddingBottom");
      }
      if (p.contentAlignment) {
        style.contentAlignment = p.contentAlignment;
        fields.push("contentAlignment");
      }
      if (fields.length === 0) {
        throw new Error(
          "googleDocs.document.updateTableCellStyle: at least one style property required",
        );
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTableCellStyle: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: tableStartLocation(p),
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
    access: "write",
    description: "Merge a contiguous block of cells in a table.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...TableLocationInput,
        rowSpan: PositiveSpan,
        columnSpan: PositiveSpan,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          mergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: tableStartLocation(p),
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
    access: "write",
    description: "Unmerge a previously merged block of cells.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...TableLocationInput,
        rowSpan: PositiveSpan,
        columnSpan: PositiveSpan,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          unmergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: tableStartLocation(p),
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

  rl.registerAction("document.updateTableColumnProperties", {
    access: "write",
    description:
      "Update table column properties such as width for selected columns or all columns.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        tableStartIndex: t.Integer({ minimum: 0 }),
        columnIndices: t.Optional(
          t.Array(t.Integer({ minimum: 0 }), { minItems: 1 }),
        ),
        widthPt: t.Optional(PositivePoints),
        widthType: t.Optional(
          t.Union([
            t.Literal("WIDTH_TYPE_UNSPECIFIED"),
            t.Literal("EVENLY_DISTRIBUTED"),
            t.Literal("FIXED_WIDTH"),
          ]),
        ),
        fields: t.Optional(t.String({ minLength: 1 })),
        ...SegmentInput,
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["widthPt"] },
          { required: ["widthType"] },
          { required: ["fields"] },
        ],
      },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const props: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.widthPt !== undefined) {
        props.width = point(p.widthPt);
        props.widthType = (p.widthType as string | undefined) ?? "FIXED_WIDTH";
        fields.push("width", "widthType");
      } else if (p.widthType) {
        props.widthType = p.widthType;
        fields.push("widthType");
      }
      const mask = (p.fields as string | undefined) ?? fields.join(",");
      if (!mask)
        throw new Error(
          "googleDocs.document.updateTableColumnProperties: fields or widthPt required",
        );
      return runBatchUpdate(ctx, documentId, {
        updateTableColumnProperties: compact({
          tableStartLocation: tableStartLocation(p),
          columnIndices: p.columnIndices,
          tableColumnProperties: props,
          fields: mask,
        }),
      });
    },
  });

  rl.registerAction("document.updateTableRowStyle", {
    access: "write",
    description:
      "Update table row style such as minimum row height for selected rows or all rows.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        tableStartIndex: t.Integer({ minimum: 0 }),
        rowIndices: t.Optional(
          t.Array(t.Integer({ minimum: 0 }), { minItems: 1 }),
        ),
        minRowHeightPt: t.Optional(PositivePoints),
        fields: t.Optional(t.String({ minLength: 1 })),
        ...SegmentInput,
      },
      {
        ...STRICT_OBJECT,
        anyOf: [{ required: ["minRowHeightPt"] }, { required: ["fields"] }],
      },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.minRowHeightPt !== undefined) {
        style.minRowHeight = point(p.minRowHeightPt);
        fields.push("minRowHeight");
      }
      const mask = (p.fields as string | undefined) ?? fields.join(",");
      if (!mask)
        throw new Error(
          "googleDocs.document.updateTableRowStyle: fields or minRowHeightPt required",
        );
      return runBatchUpdate(ctx, documentId, {
        updateTableRowStyle: compact({
          tableStartLocation: tableStartLocation(p),
          rowIndices: p.rowIndices,
          tableRowStyle: style,
          fields: mask,
        }),
      });
    },
  });

  rl.registerAction("document.pinTableHeaderRows", {
    access: "write",
    description: "Pin or unpin header rows in a table.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        tableStartIndex: t.Integer({ minimum: 0 }),
        pinnedHeaderRowsCount: t.Integer({ minimum: 0 }),
        ...SegmentInput,
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        pinTableHeaderRows: {
          tableStartLocation: tableStartLocation(p),
          pinnedHeaderRowsCount: p.pinnedHeaderRowsCount,
        },
      });
    },
  });
}
