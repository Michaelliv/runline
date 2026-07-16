import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_BASE,
  type CrmImportRow,
  type CrmImportRun,
  type CrmRecord,
  idSchema,
  pathSegment,
  recordTypeSchema,
  request,
  STRICT_OBJECT,
} from "./shared.js";

export function registerImportActions(rl: RunlinePluginAPI) {
  rl.registerAction("import.create", {
    access: "write",
    description:
      "Create a CRM import run for a source system. Requires a CRM admin grant.",
    inputSchema: t.Object(
      {
        sourceSystem: t.String({
          minLength: 1,
          maxLength: 100,
          pattern: "\\S",
          description: "Source system name, e.g. hubspot",
        }),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ importRun: CrmImportRun }>(
        ctx,
        `${CRM_BASE}/imports`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.importRun;
    },
  });

  rl.registerAction("import.list", {
    access: "read",
    description: "List CRM import runs. Requires a CRM admin grant.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ importRuns: CrmImportRun[] }>(
        ctx,
        `${CRM_BASE}/imports`,
      );
      return body.importRuns;
    },
  });

  rl.registerAction("import.get", {
    access: "read",
    description:
      "Get a CRM import run and its staged rows. Requires a CRM admin grant.",
    inputSchema: t.Object({ id: idSchema("Import run ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return request<{ importRun: CrmImportRun; rows: CrmImportRow[] }>(
        ctx,
        `${CRM_BASE}/imports/${pathSegment(id)}`,
      );
    },
  });

  rl.registerAction("import.stageRows", {
    access: "write",
    description:
      "Stage immutable raw rows on an import run (1-500 per call). Each row carries its typed source identity and raw payload.",
    inputSchema: t.Object(
      {
        importRunId: idSchema("Import run ID"),
        rows: t.Array(
          t.Object(
            {
              sourceId: t.String({
                minLength: 1,
                maxLength: 500,
                pattern: "\\S",
                description: "Stable ID in the source system",
              }),
              recordType: recordTypeSchema(),
              rawPayload: t.Unknown({
                description: "Immutable raw source payload",
              }),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 500 },
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { importRunId, ...payload } = input as {
        importRunId: string;
        rows: unknown[];
      };
      const body = await request<{ rows: CrmImportRow[] }>(
        ctx,
        `${CRM_BASE}/imports/${pathSegment(importRunId)}/rows`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      return body.rows;
    },
  });

  rl.registerAction("import.commitRow", {
    access: "write",
    description:
      "Commit one staged import row with its typed transformed payload. Record creation, row result, and change event commit atomically.",
    inputSchema: t.Object(
      {
        importRunId: idSchema("Import run ID"),
        rowId: idSchema("Import row ID"),
        transformedPayload: t.Unknown({
          description:
            "Typed create payload for the row's record type (matches the corresponding create action input)",
        }),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { importRunId, rowId, transformedPayload } = input as {
        importRunId: string;
        rowId: string;
        transformedPayload: unknown;
      };
      const body = await request<{ record: CrmRecord }>(
        ctx,
        `${CRM_BASE}/imports/${pathSegment(importRunId)}/rows/${pathSegment(rowId)}/commit`,
        { method: "POST", body: JSON.stringify({ transformedPayload }) },
      );
      return body.record;
    },
  });

  rl.registerAction("import.skipRow", {
    access: "write",
    description:
      "Explicitly skip a staged import row without creating a record.",
    inputSchema: t.Object(
      {
        importRunId: idSchema("Import run ID"),
        rowId: idSchema("Import row ID"),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { importRunId, rowId } = input as {
        importRunId: string;
        rowId: string;
      };
      const body = await request<{ row: CrmImportRow }>(
        ctx,
        `${CRM_BASE}/imports/${pathSegment(importRunId)}/rows/${pathSegment(rowId)}/skip`,
        { method: "POST" },
      );
      return body.row;
    },
  });

  rl.registerAction("import.commit", {
    access: "write",
    description:
      "Commit an import run. Allowed only after every staged row is imported or skipped.",
    inputSchema: t.Object({ id: idSchema("Import run ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ importRun: CrmImportRun }>(
        ctx,
        `${CRM_BASE}/imports/${pathSegment(id)}/commit`,
        { method: "POST" },
      );
      return body.importRun;
    },
  });
}
