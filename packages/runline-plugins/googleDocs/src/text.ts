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
  PositivePoints,
  RangeInput,
  runBatchUpdate,
  STRICT_OBJECT,
} from "./shared.js";

const PersonProperties = t.Object(
  { email: t.String({ minLength: 1 }) },
  STRICT_OBJECT,
);
const RichLinkProperties = t.Object(
  {
    uri: t.String({ minLength: 1 }),
    mimeType: t.Optional(t.String({ minLength: 1 })),
    title: t.Optional(t.String({ minLength: 1 })),
  },
  STRICT_OBJECT,
);
const DateElementProperties = t.Object(
  {
    timestamp: t.Optional(t.String({ minLength: 1 })),
    timeZoneId: t.Optional(t.String({ minLength: 1 })),
    locale: t.Optional(t.String({ minLength: 1 })),
    dateFormat: t.Optional(
      t.Union([
        t.Literal("DATE_FORMAT_UNSPECIFIED"),
        t.Literal("DATE_FORMAT_MONTH_DAY_ABBREVIATED"),
        t.Literal("DATE_FORMAT_MONTH_DAY_FULL"),
        t.Literal("DATE_FORMAT_MONTH_DAY_YEAR_ABBREVIATED"),
        t.Literal("DATE_FORMAT_ISO8601"),
      ]),
    ),
    timeFormat: t.Optional(
      t.Union([
        t.Literal("TIME_FORMAT_UNSPECIFIED"),
        t.Literal("TIME_FORMAT_DISABLED"),
        t.Literal("TIME_FORMAT_HOUR_MINUTE"),
        t.Literal("TIME_FORMAT_HOUR_MINUTE_TIMEZONE"),
      ]),
    ),
  },
  STRICT_OBJECT,
);

const BulletPreset = t.Union([
  t.Literal("BULLET_DISC_CIRCLE_SQUARE"),
  t.Literal("BULLET_DIAMONDX_ARROW3D_SQUARE"),
  t.Literal("BULLET_CHECKBOX"),
  t.Literal("BULLET_ARROW_DIAMOND_DISC"),
  t.Literal("BULLET_STAR_CIRCLE_SQUARE"),
  t.Literal("BULLET_ARROW3D_CIRCLE_SQUARE"),
  t.Literal("BULLET_LEFTTRIANGLE_DIAMOND_DISC"),
  t.Literal("BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE"),
  t.Literal("BULLET_DIAMOND_CIRCLE_SQUARE"),
  t.Literal("NUMBERED_DECIMAL_ALPHA_ROMAN"),
  t.Literal("NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS"),
  t.Literal("NUMBERED_DECIMAL_NESTED"),
  t.Literal("NUMBERED_UPPERALPHA_ALPHA_ROMAN"),
  t.Literal("NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL"),
  t.Literal("NUMBERED_ZERODECIMAL_ALPHA_ROMAN"),
]);

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
    access: "write",
    description:
      "Insert text at a specific index, or at the end of a segment (body/header/footer/footnote).",
    inputSchema: t.Object(
      { ...DocumentInput, text: t.String(), ...LocationInput },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const locObj = buildLocation(
        kind,
        p.segmentId as string,
        p.index as number,
        p.tabId as string | undefined,
      );
      return runBatchUpdate(ctx, documentId, {
        insertText: { text: p.text, ...locObj },
      });
    },
  });

  rl.registerAction("document.replaceAllText", {
    access: "write",
    description:
      "Replace every occurrence of a text string throughout the document.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        findText: t.String({ minLength: 1 }),
        replaceText: t.String(),
        matchCase: t.Optional(t.Boolean()),
        searchByRegex: t.Optional(t.Boolean()),
        tabIds: t.Optional(
          t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
        ),
      },
      STRICT_OBJECT,
    ),
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
    access: "write",
    description: "Delete text between two indices in a segment.",
    inputSchema: t.Object({ ...DocumentInput, ...RangeInput }, STRICT_OBJECT),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteContentRange: { range: range(p) },
      });
    },
  });

  rl.registerAction("document.createParagraphBullets", {
    access: "write",
    description:
      "Apply a bullet preset to paragraphs spanning a range. Presets: BULLET_DISC_CIRCLE_SQUARE, BULLET_DIAMONDX_ARROW3D_SQUARE, BULLET_CHECKBOX, NUMBERED_DECIMAL_ALPHA_ROMAN, NUMBERED_DECIMAL_NESTED, etc.",
    inputSchema: t.Object(
      { ...DocumentInput, bulletPreset: BulletPreset, ...RangeInput },
      STRICT_OBJECT,
    ),
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
    access: "write",
    description: "Remove bullets from paragraphs in a range.",
    inputSchema: t.Object({ ...DocumentInput, ...RangeInput }, STRICT_OBJECT),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, {
        deleteParagraphBullets: { range: range(p) },
      });
    },
  });

  rl.registerAction("document.insertPerson", {
    access: "write",
    description:
      "Insert a smart chip person mention at a location or at the end of a segment.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        personProperties: PersonProperties,
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
        insertPerson: {
          personProperties: p.personProperties,
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

  rl.registerAction("document.insertRichLink", {
    access: "write",
    description:
      "Insert a rich link smart chip at a location or at the end of a segment.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        richLinkProperties: RichLinkProperties,
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
        insertRichLink: {
          richLinkProperties: p.richLinkProperties,
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

  rl.registerAction("document.insertDate", {
    access: "write",
    description:
      "Insert a date smart chip at a location or at the end of a segment.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        dateElementProperties: t.Optional(DateElementProperties),
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
        insertDate: {
          ...(p.dateElementProperties
            ? { dateElementProperties: p.dateElementProperties }
            : {}),
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

  rl.registerAction("document.updateTextStyle", {
    access: "write",
    description:
      "Apply text styling (bold, italic, underline, color, font size, font family, or link) to a range.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...RangeInput,
        bold: t.Optional(t.Boolean()),
        italic: t.Optional(t.Boolean()),
        underline: t.Optional(t.Boolean()),
        strikethrough: t.Optional(t.Boolean()),
        fontSizePt: t.Optional(PositivePoints),
        fontFamily: t.Optional(t.String({ minLength: 1 })),
        foregroundColorHex: t.Optional(HexColor),
        backgroundColorHex: t.Optional(HexColor),
        link: t.Optional(t.String({ minLength: 1 })),
      },
      {
        ...STRICT_OBJECT,
        anyOf: [
          { required: ["bold"] },
          { required: ["italic"] },
          { required: ["underline"] },
          { required: ["strikethrough"] },
          { required: ["fontSizePt"] },
          { required: ["fontFamily"] },
          { required: ["foregroundColorHex"] },
          { required: ["backgroundColorHex"] },
          { required: ["link"] },
        ],
      },
    ),
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
          "googleDocs.document.updateTextStyle: at least one styling property required",
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
