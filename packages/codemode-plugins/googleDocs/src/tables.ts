import type { CodemodePluginAPI } from "@shiftlabs/codemode";
import * as t from "typebox";
import { HexColor, rgbColor } from "../../_shared/googleColor.js";
import { atLeastOne, STRICT } from "../../_shared/schemas.js";
import {
  buildLocation,
  compact,
  DocumentInput,
  extractDocumentId,
  LOCATION_REQUIREMENT,
  LocationInput,
  location,
  PositivePoints,
  points,
  runBatchUpdate,
  SegmentInput,
  TableLocationInput,
} from "./shared.js";

const PositiveSpan = t.Integer({ minimum: 1 });

type TableStart = {
  tableStartIndex: number;
  segmentId?: string;
  tabId?: string;
};

function tableStartLocation(p: TableStart): Record<string, unknown> {
  return location(p.tableStartIndex, p.segmentId, p.tabId);
}

function tableCellLocation(
  p: TableStart & { rowIndex: number; columnIndex: number },
): Record<string, unknown> {
  return {
    rowIndex: p.rowIndex,
    columnIndex: p.columnIndex,
    tableStartLocation: tableStartLocation(p),
  };
}

export function registerTablesActions(rl: CodemodePluginAPI) {
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
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        insertTable: {
          rows: p.rows,
          columns: p.columns,
          ...buildLocation(p),
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
    inputSchema: t.Object({ ...DocumentInput, ...TableLocationInput }, STRICT),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
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
    inputSchema: t.Object({ ...DocumentInput, ...TableLocationInput }, STRICT),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        deleteTableColumn: {
          tableCellLocation: tableCellLocation(p),
        },
      });
    },
  });

  const cellStyleFields = {
    backgroundColorHex: t.Optional(HexColor),
    paddingLeftPt: t.Optional(PositivePoints),
    paddingRightPt: t.Optional(PositivePoints),
    paddingTopPt: t.Optional(PositivePoints),
    paddingBottomPt: t.Optional(PositivePoints),
    contentAlignment: t.Optional(
      t.Union([t.Literal("TOP"), t.Literal("MIDDLE"), t.Literal("BOTTOM")]),
    ),
  };
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
        ...cellStyleFields,
      },
      {
        ...STRICT,
        ...atLeastOne(cellStyleFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.backgroundColorHex) {
        style.backgroundColor = {
          color: { rgbColor: rgbColor(p.backgroundColorHex) },
        };
        fields.push("backgroundColor");
      }
      if (p.paddingLeftPt !== undefined) {
        style.paddingLeft = points(p.paddingLeftPt);
        fields.push("paddingLeft");
      }
      if (p.paddingRightPt !== undefined) {
        style.paddingRight = points(p.paddingRightPt);
        fields.push("paddingRight");
      }
      if (p.paddingTopPt !== undefined) {
        style.paddingTop = points(p.paddingTopPt);
        fields.push("paddingTop");
      }
      if (p.paddingBottomPt !== undefined) {
        style.paddingBottom = points(p.paddingBottomPt);
        fields.push("paddingBottom");
      }
      if (p.contentAlignment) {
        style.contentAlignment = p.contentAlignment;
        fields.push("contentAlignment");
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTableCellStyle: {
            tableRange: {
              tableCellLocation: tableCellLocation(p),
              rowSpan: p.rowSpan ?? 1,
              columnSpan: p.columnSpan ?? 1,
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, [
        {
          mergeTableCells: {
            tableRange: {
              tableCellLocation: tableCellLocation(p),
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, [
        {
          unmergeTableCells: {
            tableRange: {
              tableCellLocation: tableCellLocation(p),
              rowSpan: p.rowSpan,
              columnSpan: p.columnSpan,
            },
          },
        },
      ]);
    },
  });

  const columnFields = {
    widthPt: t.Optional(PositivePoints),
    widthType: t.Optional(
      t.Union([
        t.Literal("WIDTH_TYPE_UNSPECIFIED"),
        t.Literal("EVENLY_DISTRIBUTED"),
        t.Literal("FIXED_WIDTH"),
      ]),
    ),
    fields: t.Optional(t.String({ minLength: 1 })),
  };
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
        ...SegmentInput,
        ...columnFields,
      },
      {
        ...STRICT,
        ...atLeastOne(columnFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const props: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.widthPt !== undefined) {
        props.width = points(p.widthPt);
        props.widthType = p.widthType ?? "FIXED_WIDTH";
        fields.push("width", "widthType");
      } else if (p.widthType) {
        props.widthType = p.widthType;
        fields.push("widthType");
      }
      const mask = p.fields ?? fields.join(",");
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

  const rowStyleFields = {
    minRowHeightPt: t.Optional(PositivePoints),
    fields: t.Optional(t.String({ minLength: 1 })),
  };
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
        ...SegmentInput,
        ...rowStyleFields,
      },
      {
        ...STRICT,
        ...atLeastOne(rowStyleFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const style: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.minRowHeightPt !== undefined) {
        style.minRowHeight = points(p.minRowHeightPt);
        fields.push("minRowHeight");
      }
      const mask = p.fields ?? fields.join(",");
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        pinTableHeaderRows: {
          tableStartLocation: tableStartLocation(p),
          pinnedHeaderRowsCount: p.pinnedHeaderRowsCount,
        },
      });
    },
  });
}
