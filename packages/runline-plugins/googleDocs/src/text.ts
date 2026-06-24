import type { RunlinePluginAPI } from "runline";
import {
  buildLocation,
  compact,
  extractDocumentId,
  hexToRgbF,
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

export function registerTextActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertText", {
    description:
      "Insert text at a specific index, or at the end of a segment (body/header/footer/footnote).",
    inputSchema: {
      document: { type: "string", required: true },
      text: { type: "string", required: true },
      locationKind: {
        type: "string",
        required: false,
        description:
          "location (default; requires index) | endOfSegmentLocation",
      },
      index: {
        type: "number",
        required: false,
        description: "Required for locationKind=location",
      },
      segmentId: {
        type: "string",
        required: false,
        description: 'Segment ID, or "body" / empty for the main body',
      },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const locObj = buildLocation(
        kind,
        p.segmentId as string,
        p.index as number,
        p.tabId as string | undefined
      );
      return runBatchUpdate(ctx, documentId, {
        insertText: { text: p.text, ...locObj },
      });
    },
  });

  rl.registerAction("document.replaceAllText", {
    description:
      "Replace every occurrence of a text string throughout the document.",
    inputSchema: {
      document: { type: "string", required: true },
      findText: { type: "string", required: true },
      replaceText: { type: "string", required: true },
      matchCase: { type: "boolean", required: false },
      searchByRegex: { type: "boolean", required: false },
      tabIds: {
        type: "array",
        required: false,
        description: "Optional tab IDs for tabsCriteria.",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        replaceAllText: {
          replaceText: p.replaceText,
          containsText: {
            text: p.findText,
            matchCase: p.matchCase === true,
            searchByRegex: p.searchByRegex === true,
          },
          ...(Array.isArray(p.tabIds)
            ? { tabsCriteria: { tabIds: p.tabIds } }
            : {}),
        },
      });
    },
  });

  rl.registerAction("document.deleteContentRange", {
    description: "Delete text between two indices in a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteContentRange: { range: range(p) },
      });
    },
  });

  rl.registerAction("document.createParagraphBullets", {
    description:
      "Apply a bullet preset to paragraphs spanning a range. Presets: BULLET_DISC_CIRCLE_SQUARE, BULLET_DIAMONDX_ARROW3D_SQUARE, BULLET_CHECKBOX, NUMBERED_DECIMAL_ALPHA_ROMAN, NUMBERED_DECIMAL_NESTED, etc.",
    inputSchema: {
      document: { type: "string", required: true },
      bulletPreset: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        createParagraphBullets: {
          bulletPreset: p.bulletPreset,
          range: range(p),
        },
      });
    },
  });

  rl.registerAction("document.deleteParagraphBullets", {
    description: "Remove bullets from paragraphs in a range.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteParagraphBullets: { range: range(p) },
      });
    },
  });

  rl.registerAction("document.insertPerson", {
    description:
      "Insert a smart chip person mention at a location or at the end of a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      personProperties: {
        type: "object",
        required: true,
        description: "Docs API PersonProperties object.",
      },
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
        insertPerson: {
          personProperties: p.personProperties,
          ...buildLocation(
            kind,
            p.segmentId as string,
            p.index as number,
            p.tabId as string | undefined
          ),
        },
      });
    },
  });

  rl.registerAction("document.insertRichLink", {
    description:
      "Insert a rich link smart chip at a location or at the end of a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      richLinkProperties: {
        type: "object",
        required: true,
        description: "Docs API RichLinkProperties object.",
      },
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
        insertRichLink: {
          richLinkProperties: p.richLinkProperties,
          ...buildLocation(
            kind,
            p.segmentId as string,
            p.index as number,
            p.tabId as string | undefined
          ),
        },
      });
    },
  });

  rl.registerAction("document.insertDate", {
    description:
      "Insert a date smart chip at a location or at the end of a segment.",
    inputSchema: {
      document: { type: "string", required: true },
      dateElementProperties: {
        type: "object",
        required: false,
        description: "Optional Docs API DateElementProperties object.",
      },
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
        insertDate: {
          ...(p.dateElementProperties
            ? { dateElementProperties: p.dateElementProperties }
            : {}),
          ...buildLocation(
            kind,
            p.segmentId as string,
            p.index as number,
            p.tabId as string | undefined
          ),
        },
      });
    },
  });

  rl.registerAction("document.updateTextStyle", {
    description:
      "Apply text styling (bold, italic, underline, color, fontSize, fontFamily, link) to a range. Pass `fields` listing which TextStyle properties were set.",
    inputSchema: {
      document: { type: "string", required: true },
      startIndex: { type: "number", required: true },
      endIndex: { type: "number", required: true },
      bold: { type: "boolean", required: false },
      italic: { type: "boolean", required: false },
      underline: { type: "boolean", required: false },
      strikethrough: { type: "boolean", required: false },
      fontSizePt: {
        type: "number",
        required: false,
        description: "Font size in points.",
      },
      fontFamily: { type: "string", required: false },
      foregroundColorHex: {
        type: "string",
        required: false,
        description: "Hex color, e.g. #1A73E8",
      },
      backgroundColorHex: { type: "string", required: false },
      link: {
        type: "string",
        required: false,
        description: "URL for the linked range.",
      },
      segmentId: {
        type: "string",
        required: false,
        description: "Header/footer/footnote id; omit for the body.",
      },
      tabId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const ts: Record<string, unknown> = {};
      const fields: string[] = [];
      if (p.bold !== undefined) {
        ts.bold = p.bold;
        fields.push("bold");
      }
      if (p.italic !== undefined) {
        ts.italic = p.italic;
        fields.push("italic");
      }
      if (p.underline !== undefined) {
        ts.underline = p.underline;
        fields.push("underline");
      }
      if (p.strikethrough !== undefined) {
        ts.strikethrough = p.strikethrough;
        fields.push("strikethrough");
      }
      if (p.fontSizePt !== undefined) {
        ts.fontSize = { magnitude: p.fontSizePt, unit: "PT" };
        fields.push("fontSize");
      }
      if (p.fontFamily) {
        ts.weightedFontFamily = { fontFamily: p.fontFamily };
        fields.push("weightedFontFamily");
      }
      if (p.foregroundColorHex) {
        const c = hexToRgbF(p.foregroundColorHex as string);
        ts.foregroundColor = { color: { rgbColor: c } };
        fields.push("foregroundColor");
      }
      if (p.backgroundColorHex) {
        const c = hexToRgbF(p.backgroundColorHex as string);
        ts.backgroundColor = { color: { rgbColor: c } };
        fields.push("backgroundColor");
      }
      if (p.link) {
        ts.link = { url: p.link };
        fields.push("link");
      }
      if (fields.length === 0) {
        throw new Error(
          "googleDocs.document.updateTextStyle: at least one styling property required"
        );
      }
      return runBatchUpdate(ctx, documentId, [
        {
          updateTextStyle: {
            range: range(p),
            textStyle: ts,
            fields: fields.join(","),
          },
        },
      ]);
    },
  });
}
