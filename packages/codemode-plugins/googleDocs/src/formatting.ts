import type { CodemodePluginAPI } from "@shiftlabs/codemode";
import * as t from "typebox";
import { atLeastOne, STRICT } from "../../_shared/schemas.js";
import {
  compact,
  DocumentInput,
  extractDocumentId,
  PositivePoints,
  points,
  RangeInput,
  RawGoogleObject,
  range,
  runBatchUpdate,
} from "./shared.js";

export function registerFormattingActions(rl: CodemodePluginAPI) {
  const paragraphStyleFields = {
    alignment: t.Optional(
      t.Union([
        t.Literal("START"),
        t.Literal("CENTER"),
        t.Literal("END"),
        t.Literal("JUSTIFIED"),
      ]),
    ),
    namedStyleType: t.Optional(
      t.Union([
        t.Literal("NORMAL_TEXT"),
        t.Literal("TITLE"),
        t.Literal("SUBTITLE"),
        t.Literal("HEADING_1"),
        t.Literal("HEADING_2"),
        t.Literal("HEADING_3"),
        t.Literal("HEADING_4"),
        t.Literal("HEADING_5"),
        t.Literal("HEADING_6"),
      ]),
    ),
    direction: t.Optional(
      t.Union([t.Literal("LEFT_TO_RIGHT"), t.Literal("RIGHT_TO_LEFT")]),
    ),
    indentFirstLinePt: t.Optional(PositivePoints),
    indentStartPt: t.Optional(PositivePoints),
    indentEndPt: t.Optional(PositivePoints),
    spaceAbovePt: t.Optional(PositivePoints),
    spaceBelowPt: t.Optional(PositivePoints),
    lineSpacing: t.Optional(t.Number({ minimum: 0 })),
  };
  rl.registerAction("document.updateParagraphStyle", {
    access: "write",
    description:
      "Apply paragraph styling (alignment, named style, indents, spacing, direction) to the paragraphs intersecting the range.",
    inputSchema: t.Object(
      { ...DocumentInput, ...RangeInput, ...paragraphStyleFields },
      {
        ...STRICT,
        ...atLeastOne(paragraphStyleFields),
      },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const ps: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.alignment) {
        ps.alignment = p.alignment;
        fields.push("alignment");
      }
      if (p.namedStyleType) {
        ps.namedStyleType = p.namedStyleType;
        fields.push("namedStyleType");
      }
      if (p.direction) {
        ps.direction = p.direction;
        fields.push("direction");
      }
      if (p.indentFirstLinePt !== undefined) {
        ps.indentFirstLine = points(p.indentFirstLinePt);
        fields.push("indentFirstLine");
      }
      if (p.indentStartPt !== undefined) {
        ps.indentStart = points(p.indentStartPt);
        fields.push("indentStart");
      }
      if (p.indentEndPt !== undefined) {
        ps.indentEnd = points(p.indentEndPt);
        fields.push("indentEnd");
      }
      if (p.spaceAbovePt !== undefined) {
        ps.spaceAbove = points(p.spaceAbovePt);
        fields.push("spaceAbove");
      }
      if (p.spaceBelowPt !== undefined) {
        ps.spaceBelow = points(p.spaceBelowPt);
        fields.push("spaceBelow");
      }
      if (p.lineSpacing !== undefined) {
        ps.lineSpacing = p.lineSpacing;
        fields.push("lineSpacing");
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateParagraphStyle: {
            range: range(p),
            paragraphStyle: ps,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateNamedStyle", {
    access: "write",
    description:
      "Update a named style such as NORMAL_TEXT, TITLE, or HEADING_1 using a Docs API NamedStyle object.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        namedStyle: RawGoogleObject,
        fields: t.String({ minLength: 1 }),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, {
        updateNamedStyle: compact({
          namedStyle: p.namedStyle,
          fields: p.fields,
          tabId: p.tabId,
        }),
      });
    },
  });
}
