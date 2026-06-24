import type { RunlinePluginAPI } from "runline";
import { compact, extractDocumentId, runBatchUpdate } from "./shared.js";

export function registerFormattingActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.updateParagraphStyle", {
    description:
      "Apply paragraph styling (alignment, named style, indents, spacing, direction) to the paragraphs intersecting the range.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      alignment: {
        type: "string",
        required: false,
        description: "START | CENTER | END | JUSTIFIED",
      },
      namedStyleType: {
        type: "string",
        required: false,
        description: "NORMAL_TEXT | TITLE | SUBTITLE | HEADING_1 .. HEADING_6",
      },
      direction: {
        type: "string",
        required: false,
        description: "LEFT_TO_RIGHT | RIGHT_TO_LEFT",
      },
      indentFirstLinePt: { type: "number", required: false },
      indentStartPt: { type: "number", required: false },
      indentEndPt: { type: "number", required: false },
      spaceAbovePt: { type: "number", required: false },
      spaceBelowPt: { type: "number", required: false },
      lineSpacing: {
        type: "number",
        required: false,
        description: "Percentage; 100 = single, 150 = 1.5x.",
      },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ps: Record<string, unknown> = {};
      const fields: string[] = [];
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
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
        ps.indentFirstLine = pt(p.indentFirstLinePt);
        fields.push("indentFirstLine");
      }
      if (p.indentStartPt !== undefined) {
        ps.indentStart = pt(p.indentStartPt);
        fields.push("indentStart");
      }
      if (p.indentEndPt !== undefined) {
        ps.indentEnd = pt(p.indentEndPt);
        fields.push("indentEnd");
      }
      if (p.spaceAbovePt !== undefined) {
        ps.spaceAbove = pt(p.spaceAbovePt);
        fields.push("spaceAbove");
      }
      if (p.spaceBelowPt !== undefined) {
        ps.spaceBelow = pt(p.spaceBelowPt);
        fields.push("spaceBelow");
      }
      if (p.lineSpacing !== undefined) {
        ps.lineSpacing = p.lineSpacing;
        fields.push("lineSpacing");
      }
      if (fields.length === 0) {
        throw new Error(
          "googleDocs.document.updateParagraphStyle: at least one property required"
        );
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateParagraphStyle: {
            range: compact({
              startIndex: p.startIndex,
              endIndex: p.endIndex,
              segmentId: p.segmentId,
              tabId: p.tabId,
            }),
            paragraphStyle: ps,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });

  rl.registerAction("document.updateNamedStyle", {
    description:
      "Update a named style such as NORMAL_TEXT, TITLE, or HEADING_1 using a Docs API NamedStyle object.",
    inputSchema: {
      document: { type: "string", required: true },
      namedStyle: {
        type: "object",
        required: true,
        description: "Docs API NamedStyle object. Must include namedStyleType.",
      },
      fields: {
        type: "string",
        required: true,
        description:
          "Field mask such as textStyle.bold or paragraphStyle.alignment.",
      },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
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
