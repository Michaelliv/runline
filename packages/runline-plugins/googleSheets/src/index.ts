/**
 * Google Sheets plugin for runline.
 *
 * OAuth2 user flow, same shape as the other Google plugins. Scope:
 * `auth/spreadsheets` (full read/write on user's sheets).
 *
 * Rows are passed in one of two shapes a code caller actually wants:
 *
 *   rows as arrays of arrays:  [["a","b"], ["c","d"]]
 *   rows as objects:           [{name:"a", age:30}, {name:"b", age:31}]
 *
 * Actions:
 *   spreadsheet.create / spreadsheet.get / spreadsheet.delete
 *
 *   sheet.addTab / sheet.deleteTab / sheet.listTabs
 *
 *   sheet.read              — array-of-arrays, or objects keyed by header row
 *   sheet.append            — rows to the bottom
 *   sheet.update            — update rows matched by a key column (or row_number)
 *   sheet.appendOrUpdate    — upsert
 *   sheet.clear             — whole sheet / rows / columns / range, optional keepFirstRow
 *   sheet.deleteDimension   — drop N rows or columns starting at an index
 *   sheet.batchUpdate       — raw passthrough to spreadsheets:batchUpdate
 *
 * Features: auto-column-add on update/upsert, multi-row
 * batchUpdate, RAW vs USER_ENTERED value input, appending via
 * values:append or PUT at lastRow+1, keepFirstRow on clear.
 * Filtering is intentionally the caller's job — `read` returns
 * raw rows / objects and callers post-filter.
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import { googleAccessToken } from "../../_shared/googleAuth.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleSheetsConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

type ValueInputOption = "RAW" | "USER_ENTERED";
type ValueRenderOption = "FORMATTED_VALUE" | "FORMULA" | "UNFORMATTED_VALUE";

interface SheetProperties {
  sheetId: number;
  title: string;
  index?: number;
  sheetType?: string;
  gridProperties?: {
    rowCount?: number;
    columnCount?: number;
  };
}

interface BatchUpdateDatum {
  range: string;
  values: Array<Array<string | number | boolean>>;
}

const ROW_NUMBER = "row_number";

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleSheets", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const SHEETS_BASE = "https://sheets.googleapis.com";

async function sheetsRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  baseOverride?: string,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${baseOverride ?? SHEETS_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const entry of v) url.searchParams.append(k, String(entry));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`googleSheets: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

// ─── A1 helpers ─────────────────────────────────────────────────

/**
 * Encode a range like `Sheet1!A1:B5` for use in a URL. Google's
 * docs are explicit that the sheet-name portion needs URL-encoding
 * (for non-ASCII / spaces) but the range portion should not be, so
 * we split on `!` and encode only the left side. A bare sheet name
 * gets wrapped in single quotes so Sheets doesn't try to parse
 * something like `ABC` as an A1 range.
 */
function encodeA1(range: string): string {
  if (range.includes("!")) {
    const [sheet, ranges] = range.split("!");
    return `${encodeURIComponent(sheet)}!${ranges}`;
  }
  return encodeURIComponent(`'${range}'`);
}

function columnNumberToLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || "A";
}

function columnLetterToNumber(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) throw new Error(`googleSheets: invalid column "${col}"`);
    n = n * 26 + code;
  }
  return n;
}

/**
 * Convert a row of objects into a 2D array, aligned to `columns`.
 * Missing/null/undefined cells become empty strings; object values
 * are JSON-stringified so they survive the round trip.
 */
function objectsToRows(
  rows: Record<string, unknown>[],
  columns: string[],
): string[][] {
  return rows.map((row) => {
    return columns.map((col) => {
      const v = row[col];
      if (v === undefined || v === null) return "";
      if (typeof v === "object") {
        try {
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      }
      return String(v);
    });
  });
}

/**
 * Pair a 2D array with a header row into an array of objects.
 * Blank header cells are replaced with synthetic `col_N` keys so
 * callers still see the data. Columns shorter than the header row
 * are padded with empty strings.
 */
function rowsToObjects(
  rows: string[][],
  headerRow: string[],
): Record<string, string>[] {
  const keys = headerRow.map((h, i) => (h && h.length > 0 ? h : `col_${i}`));
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
      obj[keys[i]] = row[i] ?? "";
    }
    return obj;
  });
}

// ─── Sheet operations (shared helpers) ──────────────────────────

async function getValues(
  ctx: Ctx,
  spreadsheetId: string,
  range: string,
  valueRenderOption: ValueRenderOption = "FORMATTED_VALUE",
  dateTimeRenderOption: string = "FORMATTED_STRING",
): Promise<string[][]> {
  const res = (await sheetsRequest(
    ctx,
    "GET",
    `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(range)}`,
    undefined,
    { valueRenderOption, dateTimeRenderOption },
  )) as { values?: string[][] };
  return res.values ?? [];
}

async function getSheetProperties(
  ctx: Ctx,
  spreadsheetId: string,
): Promise<SheetProperties[]> {
  const res = (await sheetsRequest(
    ctx,
    "GET",
    `/v4/spreadsheets/${spreadsheetId}`,
    undefined,
    { fields: "sheets.properties" },
  )) as { sheets: Array<{ properties: SheetProperties }> };
  return res.sheets.map((s) => s.properties);
}

async function resolveSheetId(
  ctx: Ctx,
  spreadsheetId: string,
  sheetNameOrId: string | number,
): Promise<number> {
  if (typeof sheetNameOrId === "number") return sheetNameOrId;
  const asNumber = Number(sheetNameOrId);
  const all = await getSheetProperties(ctx, spreadsheetId);
  if (!Number.isNaN(asNumber) && all.some((p) => p.sheetId === asNumber)) {
    return asNumber;
  }
  const match = all.find((p) => p.title === sheetNameOrId);
  if (!match) throw new Error(`googleSheets: sheet "${sheetNameOrId}" not found`);
  return match.sheetId;
}

async function batchValuesUpdate(
  ctx: Ctx,
  spreadsheetId: string,
  data: BatchUpdateDatum[],
  valueInputOption: ValueInputOption,
): Promise<unknown> {
  return sheetsRequest(
    ctx,
    "POST",
    `/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    { data, valueInputOption },
  );
}

async function spreadsheetBatchUpdate(
  ctx: Ctx,
  spreadsheetId: string,
  requests: Record<string, unknown>[],
): Promise<unknown> {
  return sheetsRequest(
    ctx,
    "POST",
    `/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { requests },
  );
}

async function appendEmptyRow(
  ctx: Ctx,
  spreadsheetId: string,
  sheetId: number,
): Promise<void> {
  // Called before every non-API-append write to protect the
  // PUT-at-lastRow path from "runs past end of sheet" errors. It's
  // a no-op cost when the sheet already has blank rows below the
  // data.
  await spreadsheetBatchUpdate(ctx, spreadsheetId, [
    { appendDimension: { sheetId, dimension: "ROWS", length: 1 } },
  ]);
}

// ─── Update / upsert preparation ────────────────────────────────

interface PreparedUpdate {
  updateData: BatchUpdateDatum[];
  appendData: Record<string, unknown>[];
  newColumns: string[];
}

/**
 * Turn a set of input rows (objects) into ranged cell updates plus
 * (in upsert mode) a leftover set that should be appended.
 *
 * Options:
 *   - `matchKey`: column name used to locate the target row, or the
 *     literal `"row_number"` to use a synthetic 1-indexed row field.
 *   - `upsert`: when true, rows whose match value isn't found (or
 *     whose match key is missing) are collected into `appendData`.
 *   - `handlingExtraData`: how to treat input keys that don't exist
 *     as columns yet. "ignore" drops them, "error" throws,
 *     "insertInNewColumn" extends the header row and records the
 *     added columns in `newColumns`.
 */
function prepareUpdateOrUpsert(
  inputRows: Record<string, unknown>[],
  headerRow: string[],
  keyColumnValues: string[],
  dataStartRowIndex: number,
  matchKey: string,
  opts: {
    upsert?: boolean;
    handlingExtraData?: "ignore" | "error" | "insertInNewColumn";
  } = {},
): PreparedUpdate {
  const { upsert = false, handlingExtraData = "insertInNewColumn" } = opts;
  const updateData: BatchUpdateDatum[] = [];
  const appendData: Record<string, unknown>[] = [];
  const newColumnsSet = new Set<string>();
  const columns = [...headerRow];

  const keyIndex = matchKey === ROW_NUMBER ? -1 : columns.indexOf(matchKey);
  if (matchKey !== ROW_NUMBER && keyIndex === -1 && !upsert) {
    throw new Error(`googleSheets: match column "${matchKey}" not found in header row`);
  }

  for (const row of inputRows) {
    if (handlingExtraData !== "ignore") {
      for (const key of Object.keys(row)) {
        if (key === ROW_NUMBER) continue;
        if (!columns.includes(key)) {
          if (handlingExtraData === "error") {
            throw new Error(`googleSheets: unexpected column "${key}" in input`);
          }
          newColumnsSet.add(key);
          columns.push(key);
        }
      }
    }

    // ── Row-number match ────────────────────────────────
    if (matchKey === ROW_NUMBER) {
      const rowNumber = row[ROW_NUMBER];
      if (rowNumber === undefined || rowNumber === null) {
        if (upsert) {
          appendData.push(row);
          continue;
        }
        throw new Error("googleSheets: missing row_number on input row");
      }
      const rowNum = Number(rowNumber);
      for (const name of columns) {
        if (name === ROW_NUMBER) continue;
        const v = row[name];
        if (v === undefined || v === null) continue;
        const colIdx = columns.indexOf(name);
        const colLetter = columnNumberToLetter(colIdx + 1);
        updateData.push({
          range: `${colLetter}${rowNum}`,
          values: [[stringifyCell(v)]],
        });
      }
      continue;
    }

    // ── Key-column match ───────────────────────────────
    const inputKey = row[matchKey];
    if (inputKey === undefined || inputKey === null) {
      if (upsert) appendData.push(row);
      continue;
    }
    const rowIdx = keyColumnValues.findIndex(
      (v) => v !== undefined && String(v) === String(inputKey),
    );
    if (rowIdx === -1) {
      if (upsert) appendData.push(row);
      continue;
    }
    const sheetRow = rowIdx + dataStartRowIndex + 1; // 1-indexed A1 row
    for (const name of columns) {
      if (name === matchKey) continue;
      if (name === ROW_NUMBER) continue;
      const v = row[name];
      if (v === undefined || v === null) continue;
      const colIdx = columns.indexOf(name);
      const colLetter = columnNumberToLetter(colIdx + 1);
      updateData.push({
        range: `${colLetter}${sheetRow}`,
        values: [[stringifyCell(v)]],
      });
    }
  }

  return {
    updateData,
    appendData,
    newColumns: [...newColumnsSet],
  };
}

function stringifyCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const m = hex.replace(/^#/, "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

export default function googleSheets(rl: RunlinePluginAPI) {
  rl.setName("googleSheets");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the Google Sheets API (and Drive API, required for",
      "   spreadsheet.delete):",
      "     https://console.cloud.google.com/apis/library/sheets.googleapis.com",
      "     https://console.cloud.google.com/apis/library/drive.googleapis.com",
      "",
      "3. Configure the OAuth consent screen:",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: false,
      description: "Google OAuth2 client ID",
      env: "GOOGLE_SHEETS_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: false,
      description: "Google OAuth2 client secret",
      env: "GOOGLE_SHEETS_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      description: "OAuth2 refresh token",
      env: "GOOGLE_SHEETS_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      description: "Google service account JSON credential",
      env: "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      description: "Google service account email",
      env: "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      description: "Google service account private key",
      env: "GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      description: "User email to impersonate with domain-wide delegation",
      env: "GOOGLE_SHEETS_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Spreadsheet ───────────────────────────────────────

  rl.registerAction("spreadsheet.create", {
    description: "Create a new spreadsheet",
    inputSchema: {
      title: { type: "string", required: true },
      sheets: {
        type: "array",
        required: false,
        description: "[{title, hidden?}] — initial sheet tabs",
      },
      locale: { type: "string", required: false, description: "e.g. en_US" },
      autoRecalc: {
        type: "string",
        required: false,
        description: "ON_CHANGE | MINUTE | HOUR",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        properties: {
          title: p.title,
          ...(p.locale ? { locale: p.locale } : {}),
          ...(p.autoRecalc ? { autoRecalc: p.autoRecalc } : {}),
        },
      };
      if (Array.isArray(p.sheets) && p.sheets.length > 0) {
        body.sheets = (p.sheets as Array<Record<string, unknown>>).map((s) => ({
          properties: s,
        }));
      }
      return sheetsRequest(ctx, "POST", "/v4/spreadsheets", body);
    },
  });

  rl.registerAction("spreadsheet.get", {
    description: "Get spreadsheet metadata (sheets, properties, optional grid data)",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      includeGridData: { type: "boolean", required: false },
      ranges: {
        type: "array",
        required: false,
        description: "Limit the response to specific A1 ranges",
      },
      fields: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.includeGridData) qs.includeGridData = p.includeGridData;
      if (Array.isArray(p.ranges)) qs.ranges = p.ranges;
      if (p.fields) qs.fields = p.fields;
      return sheetsRequest(
        ctx,
        "GET",
        `/v4/spreadsheets/${p.spreadsheetId}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("spreadsheet.delete", {
    description: "Delete a spreadsheet (via Drive API — requires drive.file scope)",
    inputSchema: { spreadsheetId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await sheetsRequest(
        ctx,
        "DELETE",
        `/drive/v3/files/${p.spreadsheetId}`,
        undefined,
        undefined,
        "https://www.googleapis.com",
      );
      return { success: true };
    },
  });

  // ── Sheet tabs ────────────────────────────────────────

  rl.registerAction("sheet.listTabs", {
    description: "List sheet tabs in a spreadsheet",
    inputSchema: { spreadsheetId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return getSheetProperties(ctx, p.spreadsheetId as string);
    },
  });

  rl.registerAction("sheet.addTab", {
    description: "Add a new sheet tab",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      title: { type: "string", required: true },
      index: { type: "number", required: false, description: "Position within the spreadsheet" },
      sheetId: { type: "number", required: false, description: "Custom tab ID (non-negative)" },
      hidden: { type: "boolean", required: false },
      rightToLeft: { type: "boolean", required: false },
      tabColor: { type: "string", required: false, description: "Hex RGB (e.g. #0aa55c)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const properties: Record<string, unknown> = { title: p.title };
      if (p.index !== undefined) properties.index = p.index;
      if (p.sheetId !== undefined) properties.sheetId = p.sheetId;
      if (p.hidden !== undefined) properties.hidden = p.hidden;
      if (p.rightToLeft !== undefined) properties.rightToLeft = p.rightToLeft;
      if (typeof p.tabColor === "string") {
        const rgb = hexToRgb(p.tabColor);
        if (rgb) properties.tabColor = rgb;
      }
      const res = (await spreadsheetBatchUpdate(
        ctx,
        p.spreadsheetId as string,
        [{ addSheet: { properties } }],
      )) as { replies?: Array<{ addSheet?: { properties?: SheetProperties } }> };
      return res.replies?.[0]?.addSheet?.properties ?? res;
    },
  });

  rl.registerAction("sheet.deleteTab", {
    description: "Delete a sheet tab",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: {
        type: "string",
        required: true,
        description: "Tab title or numeric sheetId",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const sheetId = await resolveSheetId(
        ctx,
        p.spreadsheetId as string,
        p.sheet as string,
      );
      await spreadsheetBatchUpdate(ctx, p.spreadsheetId as string, [
        { deleteSheet: { sheetId } },
      ]);
      return { success: true, sheetId };
    },
  });

  // ── Read ──────────────────────────────────────────────

  rl.registerAction("sheet.read", {
    description:
      "Read values from a range. Returns a 2D array by default; set `asObjects=true` to pair rows with a header row and return objects.",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      range: {
        type: "string",
        required: true,
        description: "Sheet tab name, or full A1 range (e.g. 'Sheet1!A1:C10')",
      },
      asObjects: { type: "boolean", required: false },
      headerRow: {
        type: "number",
        required: false,
        description: "1-indexed header row (default: 1, used with asObjects)",
      },
      dataStartRow: {
        type: "number",
        required: false,
        description: "1-indexed first data row (default: headerRow + 1)",
      },
      valueRenderOption: {
        type: "string",
        required: false,
        description: "FORMATTED_VALUE (default) | UNFORMATTED_VALUE | FORMULA",
      },
      dateTimeRenderOption: {
        type: "string",
        required: false,
        description: "FORMATTED_STRING (default) | SERIAL_NUMBER",
      },
      includeRowNumber: {
        type: "boolean",
        required: false,
        description: "Attach `row_number` to each object (asObjects only)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const rows = await getValues(
        ctx,
        p.spreadsheetId as string,
        p.range as string,
        (p.valueRenderOption as ValueRenderOption) ?? "FORMATTED_VALUE",
        (p.dateTimeRenderOption as string) ?? "FORMATTED_STRING",
      );
      if (!p.asObjects) return rows;

      const headerRowIdx = Math.max(1, (p.headerRow as number) ?? 1) - 1;
      const dataStartIdx =
        ((p.dataStartRow as number) ?? headerRowIdx + 2) - 1;
      const header = rows[headerRowIdx] ?? [];
      const dataRows = rows.slice(dataStartIdx);
      const objects = rowsToObjects(dataRows, header);
      if (p.includeRowNumber) {
        return objects.map((o, i) => ({
          [ROW_NUMBER]: dataStartIdx + i + 1,
          ...o,
        }));
      }
      return objects;
    },
  });

  // ── Append ────────────────────────────────────────────

  rl.registerAction("sheet.append", {
    description:
      "Append rows to the bottom. Pass `rows` as arrays (matching columns) or objects (keyed by header names; extra keys become new columns by default).",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: {
        type: "string",
        required: true,
        description: "Tab name or numeric sheetId",
      },
      rows: {
        type: "array",
        required: true,
        description: "Array of arrays, or array of objects",
      },
      headerRow: {
        type: "number",
        required: false,
        description: "1-indexed header row (default: 1, used when rows are objects)",
      },
      valueInputOption: {
        type: "string",
        required: false,
        description: "USER_ENTERED (default) | RAW",
      },
      handlingExtraData: {
        type: "string",
        required: false,
        description: "insertInNewColumn (default) | ignore | error",
      },
      useAppend: {
        type: "boolean",
        required: false,
        description:
          "Use values:append (safer w/ formulas but rewrites filters) instead of PUT at lastRow+1",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const spreadsheetId = p.spreadsheetId as string;
      const sheetName =
        typeof p.sheet === "number"
          ? (await getSheetProperties(ctx, spreadsheetId)).find(
              (s) => s.sheetId === p.sheet,
            )?.title
          : (p.sheet as string);
      if (!sheetName) throw new Error(`googleSheets: sheet "${p.sheet}" not found`);
      const rows = p.rows as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return { updatedRange: null, updatedRows: 0 };
      }
      const valueInputOption = (p.valueInputOption as ValueInputOption) ?? "USER_ENTERED";
      const headerRowIdx = Math.max(1, (p.headerRow as number) ?? 1) - 1;

      let values: Array<Array<string | number | boolean>>;
      if (Array.isArray(rows[0])) {
        values = rows as Array<Array<string | number | boolean>>;
      } else {
        // Object rows: project onto header row, optionally extending it.
        const sheetData = await getValues(ctx, spreadsheetId, sheetName, "FORMATTED_VALUE");
        let headers = sheetData[headerRowIdx] ?? [];
        const handling =
          (p.handlingExtraData as "ignore" | "error" | "insertInNewColumn") ??
          "insertInNewColumn";
        const newCols: string[] = [];
        for (const row of rows as Record<string, unknown>[]) {
          for (const k of Object.keys(row)) {
            if (k === ROW_NUMBER) continue;
            if (!headers.includes(k)) {
              if (handling === "error") {
                throw new Error(`googleSheets: unexpected column "${k}" in input`);
              }
              if (handling === "insertInNewColumn" && !newCols.includes(k)) {
                newCols.push(k);
              }
            }
          }
        }
        if (newCols.length > 0) {
          headers = [...headers, ...newCols];
          // Write the extended header row back to the sheet.
          await sheetsRequest(
            ctx,
            "PUT",
            `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(
              `${sheetName}!A${headerRowIdx + 1}`,
            )}`,
            { range: `${sheetName}!A${headerRowIdx + 1}`, values: [headers] },
            { valueInputOption },
          );
        }
        values = objectsToRows(rows as Record<string, unknown>[], headers);
      }

      if (p.useAppend) {
        return sheetsRequest(
          ctx,
          "POST",
          `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(sheetName)}:append`,
          { range: sheetName, values },
          { valueInputOption, insertDataOption: "INSERT_ROWS" },
        );
      }
      // PUT at lastRow+1: calculate lastRow from current sheet contents.
      const existing = await getValues(ctx, spreadsheetId, sheetName, "UNFORMATTED_VALUE");
      const lastRow = existing.length;
      const sheetId = await resolveSheetId(ctx, spreadsheetId, sheetName);
      await appendEmptyRow(ctx, spreadsheetId, sheetId);
      const targetRange = `${sheetName}!${lastRow + 1}:${lastRow + values.length}`;
      return sheetsRequest(
        ctx,
        "PUT",
        `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(targetRange)}`,
        { range: targetRange, values },
        { valueInputOption },
      );
    },
  });

  // ── Update ────────────────────────────────────────────

  rl.registerAction("sheet.update", {
    description:
      "Update rows matched by a key column (or by the synthetic 'row_number' field). Rows are objects; undefined/null values are skipped.",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: { type: "string", required: true },
      rows: { type: "array", required: true, description: "Array of objects" },
      matchKey: {
        type: "string",
        required: true,
        description: "Column name to match on, or 'row_number'",
      },
      headerRow: { type: "number", required: false, description: "1-indexed (default: 1)" },
      dataStartRow: { type: "number", required: false },
      valueInputOption: { type: "string", required: false },
      handlingExtraData: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return runUpdateOrUpsert(ctx, p, false);
    },
  });

  rl.registerAction("sheet.appendOrUpdate", {
    description:
      "Upsert rows. Rows whose match value is found are updated in place; rows with a missing or unknown match value are appended.",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: { type: "string", required: true },
      rows: { type: "array", required: true, description: "Array of objects" },
      matchKey: { type: "string", required: true },
      headerRow: { type: "number", required: false },
      dataStartRow: { type: "number", required: false },
      valueInputOption: { type: "string", required: false },
      handlingExtraData: { type: "string", required: false },
      useAppend: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return runUpdateOrUpsert(ctx, p, true);
    },
  });

  // ── Clear ─────────────────────────────────────────────

  rl.registerAction("sheet.clear", {
    description:
      "Clear values from a sheet. Modes: wholeSheet (optional keepFirstRow) | rows | columns | range.",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: { type: "string", required: true },
      mode: {
        type: "string",
        required: false,
        description: "wholeSheet (default) | rows | columns | range",
      },
      startRow: { type: "number", required: false, description: "1-indexed, for mode=rows" },
      rowCount: { type: "number", required: false, description: "for mode=rows" },
      startColumn: { type: "string", required: false, description: "A1 letter, for mode=columns" },
      columnCount: { type: "number", required: false, description: "for mode=columns" },
      range: { type: "string", required: false, description: "A1 region, for mode=range" },
      keepFirstRow: {
        type: "boolean",
        required: false,
        description: "mode=wholeSheet only — preserve row 1",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const sheetName =
        typeof p.sheet === "number"
          ? (await getSheetProperties(ctx, p.spreadsheetId as string)).find(
              (s) => s.sheetId === p.sheet,
            )?.title
          : (p.sheet as string);
      if (!sheetName) throw new Error(`googleSheets: sheet "${p.sheet}" not found`);
      const mode = (p.mode as string) ?? "wholeSheet";
      let range: string;
      if (mode === "rows") {
        const start = (p.startRow as number) ?? 1;
        const count = (p.rowCount as number) ?? 1;
        const end = count === 1 ? start : start + count - 1;
        range = `${sheetName}!${start}:${end}`;
      } else if (mode === "columns") {
        const startCol = (p.startColumn as string) ?? "A";
        const count = (p.columnCount as number) ?? 1;
        const startN = columnLetterToNumber(startCol);
        const endN = count === 1 ? startN : startN + count - 1;
        range = `${sheetName}!${startCol}:${columnNumberToLetter(endN)}`;
      } else if (mode === "range") {
        const region = String(p.range ?? "");
        range = region.includes("!") ? `${sheetName}!${region.split("!")[1]}` : `${sheetName}!${region}`;
      } else {
        range = sheetName;
      }

      if (mode === "wholeSheet" && p.keepFirstRow) {
        const firstRow = await getValues(
          ctx,
          p.spreadsheetId as string,
          `${sheetName}!1:1`,
          "FORMATTED_VALUE",
        );
        await sheetsRequest(
          ctx,
          "POST",
          `/v4/spreadsheets/${p.spreadsheetId}/values/${encodeA1(range)}:clear`,
          {},
        );
        if (firstRow.length > 0) {
          await sheetsRequest(
            ctx,
            "PUT",
            `/v4/spreadsheets/${p.spreadsheetId}/values/${encodeA1(`${sheetName}!1:1`)}`,
            { range: `${sheetName}!1:1`, values: firstRow },
            { valueInputOption: "RAW" },
          );
        }
        return { success: true };
      }
      return sheetsRequest(
        ctx,
        "POST",
        `/v4/spreadsheets/${p.spreadsheetId}/values/${encodeA1(range)}:clear`,
        {},
      );
    },
  });

  // ── Delete rows/columns ───────────────────────────────

  rl.registerAction("sheet.deleteDimension", {
    description: "Delete a range of rows or columns",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      sheet: { type: "string", required: true },
      dimension: { type: "string", required: true, description: "ROWS | COLUMNS" },
      startIndex: {
        type: "number",
        required: true,
        description: "1-indexed (row number) or column letter position",
      },
      count: { type: "number", required: false, description: "How many to delete (default: 1)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const sheetId = await resolveSheetId(
        ctx,
        p.spreadsheetId as string,
        p.sheet as string,
      );
      const start = ((p.startIndex as number) ?? 1) - 1; // Sheets API is 0-indexed
      const count = (p.count as number) ?? 1;
      await spreadsheetBatchUpdate(ctx, p.spreadsheetId as string, [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: String(p.dimension).toUpperCase(),
              startIndex: start,
              endIndex: start + count,
            },
          },
        },
      ]);
      return { success: true };
    },
  });

  // ── Raw batchUpdate ───────────────────────────────────

  rl.registerAction("sheet.batchUpdate", {
    description:
      "Raw passthrough to spreadsheets:batchUpdate for anything this plugin doesn't expose directly (formatting, merges, conditional rules, …).",
    inputSchema: {
      spreadsheetId: { type: "string", required: true },
      requests: { type: "array", required: true },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return spreadsheetBatchUpdate(
        ctx,
        p.spreadsheetId as string,
        p.requests as Record<string, unknown>[],
      );
    },
  });
}

/**
 * Shared implementation for `sheet.update` and `sheet.appendOrUpdate`.
 * Reads current headers + the key column, decides per row whether
 * it's an update or an append, issues one `values:batchUpdate` for
 * the updates, and (in upsert mode) falls through to the append
 * path for the rest.
 */
async function runUpdateOrUpsert(
  ctx: Ctx,
  p: Record<string, unknown>,
  upsert: boolean,
): Promise<unknown> {
  const spreadsheetId = p.spreadsheetId as string;
  const sheetIdOrName = p.sheet as string;
  const rows = p.rows as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { updated: 0, appended: 0 };
  }
  const matchKey = p.matchKey as string;
  if (!matchKey) throw new Error("googleSheets: matchKey is required");
  const valueInputOption = (p.valueInputOption as ValueInputOption) ?? "USER_ENTERED";

  const allProps = await getSheetProperties(ctx, spreadsheetId);
  const prop = allProps.find(
    (s) => s.title === sheetIdOrName || String(s.sheetId) === String(sheetIdOrName),
  );
  if (!prop) throw new Error(`googleSheets: sheet "${sheetIdOrName}" not found`);
  const sheetName = prop.title;
  const sheetId = prop.sheetId;

  const headerRowIdx = Math.max(1, (p.headerRow as number) ?? 1) - 1;
  const dataStartRowIdx = Math.max(headerRowIdx + 1, ((p.dataStartRow as number) ?? headerRowIdx + 2) - 1);
  const handlingExtraData =
    (p.handlingExtraData as "ignore" | "error" | "insertInNewColumn") ?? "insertInNewColumn";

  // Headers come from FORMATTED_VALUE (cosmetic strings). The match
  // column needs UNFORMATTED_VALUE so "1,234" in input matches 1234
  // on the sheet (issue a second fetch with UNFORMATTED_VALUE).
  const sheetData = await getValues(ctx, spreadsheetId, sheetName, "FORMATTED_VALUE");
  let headers = sheetData[headerRowIdx] ?? [];
  let keyColumnValues: string[] = [];
  if (matchKey !== ROW_NUMBER) {
    const idx = headers.indexOf(matchKey);
    if (idx === -1) {
      if (!upsert) throw new Error(`googleSheets: match column "${matchKey}" not found`);
    } else {
      const unformatted = await getValues(
        ctx,
        spreadsheetId,
        sheetName,
        "UNFORMATTED_VALUE",
      );
      keyColumnValues = unformatted.slice(dataStartRowIdx).map((r) => String(r[idx] ?? ""));
    }
  }

  const prepared = prepareUpdateOrUpsert(
    rows,
    headers,
    keyColumnValues,
    dataStartRowIdx,
    matchKey,
    { upsert, handlingExtraData },
  );

  // If we added new columns, extend the header row on the sheet first.
  if (prepared.newColumns.length > 0) {
    headers = [...headers, ...prepared.newColumns];
    await sheetsRequest(
      ctx,
      "PUT",
      `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(
        `${sheetName}!${headerRowIdx + 1}:${headerRowIdx + 1}`,
      )}`,
      {
        range: `${sheetName}!${headerRowIdx + 1}:${headerRowIdx + 1}`,
        values: [headers],
      },
      { valueInputOption },
    );
  }

  // Qualify update ranges with the sheet name (prepareUpdateOrUpsert
  // returned bare A1 cells like "C5").
  const updateData: BatchUpdateDatum[] = prepared.updateData.map((d) => ({
    range: `${sheetName}!${d.range}`,
    values: d.values,
  }));

  if (updateData.length > 0) {
    await batchValuesUpdate(ctx, spreadsheetId, updateData, valueInputOption);
  }

  if (upsert && prepared.appendData.length > 0) {
    const values = objectsToRows(prepared.appendData, headers);
    if (p.useAppend) {
      await sheetsRequest(
        ctx,
        "POST",
        `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(sheetName)}:append`,
        { range: sheetName, values },
        { valueInputOption, insertDataOption: "INSERT_ROWS" },
      );
    } else {
      const lastRow = sheetData.length;
      await appendEmptyRow(ctx, spreadsheetId, sheetId);
      const targetRange = `${sheetName}!${lastRow + 1}:${lastRow + values.length}`;
      await sheetsRequest(
        ctx,
        "PUT",
        `/v4/spreadsheets/${spreadsheetId}/values/${encodeA1(targetRange)}`,
        { range: targetRange, values },
        { valueInputOption },
      );
    }
  }

  return {
    updated: prepared.updateData.length,
    appended: prepared.appendData.length,
    newColumns: prepared.newColumns,
  };
}
