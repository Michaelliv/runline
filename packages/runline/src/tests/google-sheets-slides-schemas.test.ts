import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import googleSheets from "../../../runline-plugins/googleSheets/src/index.js";
import googleSlides from "../../../runline-plugins/googleSlides/src/index.js";
import type { RunlinePluginAPI } from "../plugin/api.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionDef, PluginDef } from "../plugin/types.js";

function resolvePlugin(
  name: string,
  register: (api: RunlinePluginAPI) => void,
): PluginDef {
  const { api, resolve } = createPluginAPI(name);
  register(api);
  return resolve();
}

const sheets = resolvePlugin("googleSheets", googleSheets);
const slides = resolvePlugin("googleSlides", googleSlides);

const SHEETS_ACTIONS = [
  "spreadsheet.create",
  "spreadsheet.get",
  "spreadsheet.delete",
  "sheet.listTabs",
  "sheet.addTab",
  "sheet.deleteTab",
  "sheet.read",
  "sheet.append",
  "sheet.update",
  "sheet.appendOrUpdate",
  "sheet.clear",
  "sheet.deleteDimension",
  "sheet.batchUpdate",
  "chart.add",
  "chart.update",
  "chart.delete",
  "namedRange.add",
  "namedRange.delete",
  "protectedRange.add",
  "protectedRange.delete",
  "conditionalFormat.add",
  "conditionalFormat.delete",
  "dataValidation.set",
] as const;

const SLIDES_ACTIONS = [
  "presentation.create",
  "presentation.get",
  "presentation.listSlides",
  "presentation.replaceText",
  "presentation.batchUpdate",
  "page.get",
  "page.getThumbnail",
] as const;

const validSheetsInputs: Record<(typeof SHEETS_ACTIONS)[number], unknown> = {
  "spreadsheet.create": { title: "Quarterly plan" },
  "spreadsheet.get": { spreadsheetId: "spreadsheet-1" },
  "spreadsheet.delete": { spreadsheetId: "spreadsheet-1" },
  "sheet.listTabs": { spreadsheetId: "spreadsheet-1" },
  "sheet.addTab": { spreadsheetId: "spreadsheet-1", title: "Data" },
  "sheet.deleteTab": { spreadsheetId: "spreadsheet-1", sheet: 123 },
  "sheet.read": { spreadsheetId: "spreadsheet-1", range: "Data!A1:B2" },
  "sheet.append": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    rows: [["name", 1, true, null]],
  },
  "sheet.update": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    rows: [{ id: 1, name: "Ada" }],
    matchKey: "id",
  },
  "sheet.appendOrUpdate": {
    spreadsheetId: "spreadsheet-1",
    sheet: 123,
    rows: [{ id: 1, name: "Ada" }],
    matchKey: "id",
  },
  "sheet.clear": { spreadsheetId: "spreadsheet-1", sheet: "Data" },
  "sheet.deleteDimension": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    dimension: "ROWS",
    startIndex: 1,
  },
  "sheet.batchUpdate": {
    spreadsheetId: "spreadsheet-1",
    requests: [{ addSheet: { properties: { title: "New" } } }],
  },
  "chart.add": {
    spreadsheetId: "spreadsheet-1",
    anchorSheet: "Dashboard",
    chartSpec: { title: "Revenue" },
  },
  "chart.update": {
    spreadsheetId: "spreadsheet-1",
    chartId: 1,
    chartSpec: { title: "Revenue" },
  },
  "chart.delete": { spreadsheetId: "spreadsheet-1", chartId: 1 },
  "namedRange.add": {
    spreadsheetId: "spreadsheet-1",
    name: "Revenue",
    sheet: "Data",
    range: "A1:B10",
  },
  "namedRange.delete": {
    spreadsheetId: "spreadsheet-1",
    namedRangeId: "range-1",
  },
  "protectedRange.add": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    editorEmails: ["owner@example.com"],
  },
  "protectedRange.delete": {
    spreadsheetId: "spreadsheet-1",
    protectedRangeId: 1,
  },
  "conditionalFormat.add": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    range: "A1:A10",
    condition: { type: "NUMBER_GREATER", values: [] },
  },
  "conditionalFormat.delete": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    index: 0,
  },
  "dataValidation.set": {
    spreadsheetId: "spreadsheet-1",
    sheet: "Data",
    range: "A1:A10",
    clear: true,
  },
};

const validSlidesInputs: Record<(typeof SLIDES_ACTIONS)[number], unknown> = {
  "presentation.create": { title: "Quarterly review" },
  "presentation.get": { presentation: "presentation-1" },
  "presentation.listSlides": { presentation: "presentation-1" },
  "presentation.replaceText": {
    presentation: "presentation-1",
    replacements: [{ text: "Q1", replaceText: "Q2" }],
  },
  "presentation.batchUpdate": {
    presentation: "presentation-1",
    requests: [{ createSlide: {} }],
  },
  "page.get": { presentation: "presentation-1", pageObjectId: "slide-1" },
  "page.getThumbnail": {
    presentation: "presentation-1",
    pageObjectId: "slide-1",
  },
};

function actionMap(plugin: PluginDef): Map<string, ActionDef> {
  return new Map(plugin.actions.map((action) => [action.name, action]));
}

function requiredAction(
  actions: Map<string, ActionDef>,
  name: string,
): ActionDef {
  const action = actions.get(name);
  assert.ok(action, `${name} must be registered`);
  return action;
}

function schemaFor(action: ActionDef): TSchema {
  assert.ok(action.inputSchema, `${action.name} must declare an input schema`);
  return action.inputSchema as TSchema;
}

function expectValid(action: ActionDef, input: unknown): void {
  assert.equal(
    Check(schemaFor(action), input),
    true,
    `${action.name} should accept ${JSON.stringify(input)}`,
  );
}

function expectInvalid(action: ActionDef, input: unknown): void {
  assert.equal(
    Check(schemaFor(action), input),
    false,
    `${action.name} should reject ${JSON.stringify(input)}`,
  );
}

const NO_INVALID_VALUE = Symbol("no-invalid-value");

function invalidValueFor(schema: TSchema): unknown | typeof NO_INVALID_VALUE {
  const metadata = schema as TSchema & {
    type?: string;
    const?: unknown;
    anyOf?: TSchema[];
  };
  if (metadata.const !== undefined) {
    return typeof metadata.const === "string" ? "__invalid__" : null;
  }
  if (metadata.anyOf) {
    const types = new Set(
      metadata.anyOf.map((branch) => (branch as { type?: string }).type),
    );
    if (types.has("string") || types.has("number") || types.has("integer")) {
      return false;
    }
    return null;
  }
  switch (metadata.type) {
    case "string":
      return 42;
    case "number":
    case "integer":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    case "array":
      return {};
    case "object":
      return [];
    default:
      return NO_INVALID_VALUE;
  }
}

function assertSchemaContracts(
  plugin: PluginDef,
  fixtures: Record<string, unknown>,
): void {
  const actions = actionMap(plugin);
  for (const [name, fixture] of Object.entries(fixtures)) {
    const action = actions.get(name);
    assert.ok(action, `${name} must be registered`);
    const schema = schemaFor(action) as TSchema & {
      type?: string;
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, TSchema>;
    };
    assert.equal(
      schema.type,
      "object",
      `${name} must use a top-level object schema`,
    );
    assert.equal(
      schema.additionalProperties,
      false,
      `${name} must reject unknown fields`,
    );
    expectValid(action, fixture);
    expectInvalid(action, { ...(fixture as object), unexpected: true });

    for (const required of schema.required ?? []) {
      const missing = { ...(fixture as Record<string, unknown>) };
      delete missing[required];
      expectInvalid(action, missing);
    }

    for (const [property, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      const invalidValue = invalidValueFor(propertySchema);
      if (invalidValue === NO_INVALID_VALUE) continue;
      expectInvalid(action, {
        ...(fixture as Record<string, unknown>),
        [property]: invalidValue,
      });
    }
  }
}

describe("Google Sheets TypeBox schemas", () => {
  it("registers the exact 23-action surface, including advanced actions", () => {
    assert.deepEqual(
      sheets.actions.map((action) => action.name),
      [...SHEETS_ACTIONS],
    );
  });

  it("strictly validates every action and every required field", () => {
    assertSchemaContracts(sheets, validSheetsInputs);
  });

  it("accepts both supported row shapes and sheet reference types", () => {
    const append = requiredAction(actionMap(sheets), "sheet.append");
    expectValid(append, {
      spreadsheetId: "spreadsheet-1",
      sheet: 7,
      rows: [{ name: "Ada", metadata: { active: true } }],
    });
    expectValid(append, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      rows: [["Ada", 42, false, null]],
    });
    expectInvalid(append, {
      spreadsheetId: "spreadsheet-1",
      sheet: false,
      rows: [["Ada"]],
    });
    expectInvalid(append, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      rows: [["Ada"], { name: "Grace" }],
    });
  });

  it("enforces unambiguous chart, formatting, clear, and validation modes", () => {
    const actions = actionMap(sheets);
    const chartAdd = requiredAction(actions, "chart.add");
    const conditionalFormatAdd = requiredAction(
      actions,
      "conditionalFormat.add",
    );
    const clear = requiredAction(actions, "sheet.clear");
    const dataValidationSet = requiredAction(actions, "dataValidation.set");

    expectValid(chartAdd, {
      spreadsheetId: "spreadsheet-1",
      anchorSheet: 1,
      sourceSheet: "Data",
      sourceRange: "A1:B10",
      type: "LINE",
    });
    expectInvalid(chartAdd, {
      spreadsheetId: "spreadsheet-1",
      anchorSheet: "Dashboard",
    });
    expectInvalid(chartAdd, {
      spreadsheetId: "spreadsheet-1",
      anchorSheet: "Dashboard",
      sourceSheet: "Data",
    });
    expectInvalid(chartAdd, {
      spreadsheetId: "spreadsheet-1",
      anchorSheet: "Dashboard",
      chartSpec: { title: "Raw" },
      sourceSheet: "Data",
      sourceRange: "A1:B10",
    });
    expectInvalid(conditionalFormatAdd, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      range: "A1:A10",
    });
    expectInvalid(conditionalFormatAdd, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      range: "A1:A10",
      rule: { custom: true },
      condition: { type: "TEXT_EQ" },
    });
    expectInvalid(clear, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      mode: "range",
    });
    expectInvalid(clear, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      mode: "rows",
      range: "A1:A10",
    });
    expectValid(dataValidationSet, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      range: "A1:A10",
      oneOfList: ["yes", "no"],
    });
    expectInvalid(dataValidationSet, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      range: "A1:A10",
      clear: false,
    });
    expectInvalid(dataValidationSet, {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      range: "A1:A10",
      clear: true,
      oneOfList: ["yes", "no"],
    });
  });

  it("rejects malformed nested inputs and invalid enums", () => {
    const actions = actionMap(sheets);
    expectInvalid(requiredAction(actions, "spreadsheet.create"), {
      title: "Book",
      sheets: [{ title: "Data", surprise: true }],
    });
    expectInvalid(requiredAction(actions, "sheet.read"), {
      spreadsheetId: "spreadsheet-1",
      range: "Data",
      valueRenderOption: "RAW",
    });
    expectInvalid(requiredAction(actions, "sheet.deleteDimension"), {
      spreadsheetId: "spreadsheet-1",
      sheet: "Data",
      dimension: "CELLS",
      startIndex: 0,
    });
    expectInvalid(requiredAction(actions, "chart.add"), {
      spreadsheetId: "spreadsheet-1",
      anchorSheet: "Dashboard",
      chartSpec: {},
      widthPx: 0,
    });
  });
});

describe("Google Slides TypeBox schemas", () => {
  it("registers the exact seven-action surface", () => {
    assert.deepEqual(
      slides.actions.map((action) => action.name),
      [...SLIDES_ACTIONS],
    );
  });

  it("strictly validates every action and every required field", () => {
    assertSchemaContracts(slides, validSlidesInputs);
  });

  it("validates replacement entries deeply", () => {
    const replace = requiredAction(
      actionMap(slides),
      "presentation.replaceText",
    );
    expectValid(replace, {
      presentation: "presentation-1",
      replacements: [
        {
          text: "Q1",
          replaceText: "",
          matchCase: true,
          pageObjectIds: ["slide-1"],
        },
      ],
    });
    expectInvalid(replace, {
      presentation: "presentation-1",
      replacements: [],
    });
    expectInvalid(replace, {
      presentation: "presentation-1",
      replacements: [{ text: "", replaceText: "Q2" }],
    });
    expectInvalid(replace, {
      presentation: "presentation-1",
      replacements: [{ text: "Q1", replaceText: "Q2", extra: true }],
    });
  });

  it("keeps raw requests open while strictly typing their containers", () => {
    const actions = actionMap(slides);
    const batchUpdate = requiredAction(actions, "presentation.batchUpdate");
    expectValid(batchUpdate, {
      presentation: "presentation-1",
      requests: [{ customFutureRequest: { arbitrary: true } }],
      writeControl: { requiredRevisionId: "revision-1" },
    });
    expectInvalid(batchUpdate, {
      presentation: "presentation-1",
      requests: [],
    });
    expectInvalid(batchUpdate, {
      presentation: "presentation-1",
      requests: [{}],
      writeControl: { requiredRevisionId: "revision-1", extra: true },
    });
  });

  it("restricts thumbnail options to provider-supported enums", () => {
    const thumbnail = requiredAction(actionMap(slides), "page.getThumbnail");
    expectValid(thumbnail, {
      presentation: "presentation-1",
      pageObjectId: "slide-1",
      mimeType: "PNG",
      thumbnailSize: "LARGE",
      download: true,
    });
    expectInvalid(thumbnail, {
      presentation: "presentation-1",
      pageObjectId: "slide-1",
      mimeType: "JPEG",
    });
    expectInvalid(thumbnail, {
      presentation: "presentation-1",
      pageObjectId: "slide-1",
      thumbnailSize: "HUGE",
    });
  });
});
