import type { RunlinePluginAPI } from "runline";
import {
  buildLocation,
  extractDocumentId,
  hexToRgbF,
  runBatchUpdate,
} from "./shared.js";

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
          ...buildLocation(kind, p.segmentId as string, p.index as number),
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        insertTableRow: {
          insertBelow: p.insertBelow === true,
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteTableRow: {
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        insertTableColumn: {
          insertRight: p.insertRight === true,
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const seg =
        p.segmentId && p.segmentId !== "body" ? (p.segmentId as string) : "";
      return runBatchUpdate(ctx, documentId, {
        deleteTableColumn: {
          tableCellLocation: {
            rowIndex: p.rowIndex,
            columnIndex: p.columnIndex,
            tableStartLocation: { segmentId: seg, index: p.tableStartIndex },
          },
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
          "googleDocs.document.updateTableCellStyle: at least one style property required"
        );
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTableCellStyle: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          mergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
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
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          unmergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: p.tableStartIndex },
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
}
