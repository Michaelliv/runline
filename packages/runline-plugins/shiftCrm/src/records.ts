import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_BASE,
  CRM_PROPERTY_DATA_TYPE,
  type CrmChangeEvent,
  type CrmPropertyDefinition,
  enumSchema,
  idSchema,
  listParams,
  pathSegment,
  recordTypeSchema,
  request,
  STRICT_OBJECT,
  withQuery,
} from "./shared.js";

export function registerRecordActions(rl: RunlinePluginAPI) {
  rl.registerAction("record.changeEvents", {
    access: "read",
    description:
      "List the immutable change-event history (created/updated snapshots) for a CRM record.",
    inputSchema: t.Object(
      { recordId: idSchema("CRM record ID") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { recordId } = input as { recordId: string };
      const body = await request<{ changeEvents: CrmChangeEvent[] }>(
        ctx,
        `${CRM_BASE}/records/${pathSegment(recordId)}/change-events`,
      );
      return body.changeEvents;
    },
  });

  rl.registerAction("propertyDefinition.list", {
    access: "read",
    description:
      "List governed custom-property definitions, optionally for one record type.",
    inputSchema: t.Object(
      { recordType: t.Optional(recordTypeSchema()) },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{
        propertyDefinitions: CrmPropertyDefinition[];
      }>(ctx, withQuery(`${CRM_BASE}/property-definitions`, listParams(input)));
      return body.propertyDefinitions;
    },
  });

  rl.registerAction("propertyDefinition.create", {
    access: "write",
    description:
      "Define a governed custom property for a record type. Requires a CRM admin grant. Enum types require options.",
    inputSchema: t.Object(
      {
        recordType: recordTypeSchema(),
        key: t.String({
          maxLength: 100,
          pattern: "^[a-z][a-z0-9_]*$",
          description: "snake_case property key",
        }),
        label: t.String({
          minLength: 1,
          maxLength: 200,
          pattern: "\\S",
          description: "Human-readable label",
        }),
        dataType: enumSchema("Property data type", CRM_PROPERTY_DATA_TYPE),
        options: t.Optional(
          t.Array(t.String({ minLength: 1, maxLength: 500, pattern: "\\S" }), {
            description: "Allowed values for enum and multi_enum types",
          }),
        ),
        validation: t.Optional(
          t.Object(
            {
              minLength: t.Optional(t.Integer({ minimum: 0 })),
              maxLength: t.Optional(t.Integer({ minimum: 0 })),
              minimum: t.Optional(t.Number()),
              maximum: t.Optional(t.Number()),
              pattern: t.Optional(t.String({ maxLength: 1_000 })),
            },
            { additionalProperties: false },
          ),
        ),
        filterable: t.Optional(t.Boolean()),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        dataType: string;
        options?: string[];
        validation?: { pattern?: string };
      };
      const isEnum =
        fields.dataType === "enum" || fields.dataType === "multi_enum";
      const options = fields.options ?? [];
      if (isEnum && options.length === 0) {
        throw new Error("Enum property definitions require options");
      }
      if (!isEnum && options.length > 0) {
        throw new Error("Options are only allowed on enum property types");
      }
      if (new Set(options).size !== options.length) {
        throw new Error("Duplicate property option");
      }
      if (fields.validation?.pattern) {
        try {
          new RegExp(fields.validation.pattern);
        } catch {
          throw new Error("Property validation pattern is not a valid regex");
        }
      }
      const body = await request<{
        propertyDefinition: CrmPropertyDefinition;
      }>(ctx, `${CRM_BASE}/property-definitions`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.propertyDefinition;
    },
  });
}
