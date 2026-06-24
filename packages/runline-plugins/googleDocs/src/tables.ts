import type { RunlinePluginAPI } from "runline";
import {
  buildLocation,
  compact,
  extractDocumentId,
  hexToRgbF,
  location,
  runBatchUpdate,
} from "./shared.js";

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
    description: "Insert an empty table with the given dimensions.",
    inputSchema: {
      document: { type: "string", required: true },
      rows: { type: "number", required: true },
      columns: { type: "number", required: true },
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
    description:
      "Insert a table row above or below a cell in an existing table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: {
        type: "number",
        required: true,
        description: "Document index where the table begins",
      },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      insertBelow: {
        type: "boolean",
        required: false,
        description: "default: false (insert above)",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description: "Delete a specific row from a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description: "Insert a column left or right of a cell.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      insertRight: {
        type: "boolean",
        required: false,
        description: "default: false (insert left)",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description: "Delete a specific column from a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description:
      "Apply table-cell styling (background color, borders, padding) to a contiguous span of cells. Pass either a single cell via `tableStartLocation+rowIndex+columnIndex`, or a range via `tableStartLocation+rowSpan+columnSpan`.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: {
        type: "number",
        required: true,
        description: "The startIndex of the table element.",
      },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: false, default: 1 },
      columnSpan: { type: "number", required: false, default: 1 },
      backgroundColorHex: { type: "string", required: false },
      paddingLeftPt: { type: "number", required: false },
      paddingRightPt: { type: "number", required: false },
      paddingTopPt: { type: "number", required: false },
      paddingBottomPt: { type: "number", required: false },
      contentAlignment: {
        type: "string",
        required: false,
        description: "TOP | MIDDLE | BOTTOM",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description: "Merge a contiguous block of cells in a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: true },
      columnSpan: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description: "Unmerge a previously merged block of cells.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndex: { type: "number", required: true },
      columnIndex: { type: "number", required: true },
      rowSpan: { type: "number", required: true },
      columnSpan: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
    description:
      "Update table column properties such as width for selected columns or all columns.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      columnIndices: {
        type: "array",
        required: false,
        description: "Zero-based column indices. Omit to update all columns.",
      },
      widthPt: {
        type: "number",
        required: false,
        description: "Column width in points.",
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
      const props: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.widthPt !== undefined) {
        props.width = point(p.widthPt);
        fields.push("width");
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
    description:
      "Update table row style such as minimum row height for selected rows or all rows.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      rowIndices: {
        type: "array",
        required: false,
        description: "Zero-based row indices. Omit to update all rows.",
      },
      minRowHeightPt: { type: "number", required: false },
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
    description: "Pin or unpin header rows in a table.",
    inputSchema: {
      document: { type: "string", required: true },
      tableStartIndex: { type: "number", required: true },
      pinnedHeaderRowsCount: {
        type: "number",
        required: true,
        description: "Use 0 to unpin all header rows.",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
