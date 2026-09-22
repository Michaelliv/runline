import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  call,
  clientFor,
  ENVELOPE_DOC,
  fieldsWriteSchema,
  filtersSchema,
  idempotentClientFor,
  idSchema,
  objectTypeSchema,
  paginationFields,
  relationshipsCreateSchema,
  relationshipsUpdateSchema,
  STRICT_OBJECT,
  visibilitySchema,
  withConflictRetry,
} from "./shared.js";
import type {
  BwmCreateRecordInput,
  BwmFilter,
  BwmMergeInput,
  BwmUpdateRecordInput,
} from "./vendor/models.js";

const READ_DEFINITIONS_FIRST =
  "Read definitions.get for the object type before writing: it lists every field key, its valueType, and the select options. SINGLE_SELECT / MULTI_SELECT accept an option id or its label. $stage accepts a stage id, or a stage label together with a $pipeline hint. Unknown keys fail with unknown_field / unknown_relationship and the error names the offending param (fields.tier, relationships.$owner).";

export function registerSchemaActions(rl: RunlinePluginAPI) {
  rl.registerAction("objectTypes.list", {
    access: "read",
    description:
      "List the organization's object types, built-in (account, contact, opportunity, activity, task, note) and custom. Each has slug, label, pluralLabel, system, path. Use the slug as objectType everywhere else.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return call(() => clientFor(ctx).listObjectTypes());
    },
  });

  rl.registerAction("definitions.get", {
    access: "read",
    description: `Field and relationship definitions for one object type: everything needed to write, validate, or filter it. fieldDefinitions: { "<key>": { slug, label, valueType, system, readOnly, required, typeConfiguration: { options?: [{ id, label, parentId? }], parentFieldKey?, multipleValues?, unique? } } }. relationshipDefinitions: { "<key>": { label, cardinality: HAS_ONE | HAS_MANY, objectType, inverseKey } }. Value types: TEXT NUMBER CHECKBOX CURRENCY DATE DATETIME EMAIL TELEPHONE URL SOCIAL_HANDLE ADDRESS FULL_NAME MARKDOWN SINGLE_SELECT MULTI_SELECT JSON. Multi-value types (EMAIL, TELEPHONE, URL) take arrays.`,
    inputSchema: t.Object({ objectType: objectTypeSchema() }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { objectType } = input as { objectType: string };
      return call(() => clientFor(ctx).getDefinitions(objectType));
    },
  });

  rl.registerAction("pipelines.list", {
    access: "read",
    description:
      "List opportunity pipelines with their ordered stages ({ id, key, name, position, outcome: open | won | lost }). The same stages appear as $stage options in definitions.get({ objectType: 'opportunity' }), each with parentId = pipeline id.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return call(() => clientFor(ctx).listPipelines());
    },
  });
}

export function registerRecordActions(rl: RunlinePluginAPI) {
  rl.registerAction("records.list", {
    access: "read",
    description: `Query records of one object type. Returns { data: [envelopes], object: "list", totalCount }. ${ENVELOPE_DOC} Filters AND together on field or relationship keys; a hidden record is simply absent. Use this to find-or-create: filter on $email / $phone with no operator (multi-value fields reject equal), or $name with equal, then create only when totalCount is 0.`,
    inputSchema: t.Object(
      {
        objectType: objectTypeSchema(),
        filters: t.Optional(filtersSchema()),
        includeArchived: t.Optional(
          t.Boolean({ description: "Also return archived records" }),
        ),
        ...paginationFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, filters, includeArchived, limit, offset } = input as {
        objectType: string;
        filters?: BwmFilter[];
        includeArchived?: boolean;
        limit?: number;
        offset?: number;
      };
      return call(() =>
        clientFor(ctx).listRecords(objectType, {
          filters,
          includeArchived,
          limit,
          offset,
        }),
      );
    },
  });

  rl.registerAction("records.get", {
    access: "read",
    description: `Read one record envelope by id. ${ENVELOPE_DOC} A record the caller cannot see is a 404, same as one that does not exist.`,
    inputSchema: t.Object(
      { objectType: objectTypeSchema(), id: idSchema("Record id") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, id } = input as { objectType: string; id: string };
      return call(() => clientFor(ctx).getRecord(objectType, id));
    },
  });

  rl.registerAction("records.create", {
    access: "write",
    description: `Create a record and return its envelope. ${READ_DEFINITIONS_FIRST} Writes take bare values: fields: { "$name": "Acme", "tier": "Gold" }, relationships: { "$owner": "user_1", "$contact": ["con_1"] }. Visibility defaults to org; the actor who restricts a record is always among its readers. Every create carries an Idempotency-Key.`,
    inputSchema: t.Object(
      {
        objectType: objectTypeSchema(),
        fields: fieldsWriteSchema(
          "Field key -> bare value. The required display key differs per type: $name on account, contact, opportunity, and custom types; $title on task and note (note body is $content, activity body is $body, both MARKDOWN); activity has no $name and requires $subject plus $type (free text, e.g. call, email, meeting). Contact identities are $email (array), $phone (array, E.164), $whatsapp (array), $linkedIn (a full https://linkedin.com/in/... URL). Required keys are marked required in definitions.get.",
        ),
        relationships: t.Optional(relationshipsCreateSchema()),
        externalId: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 500,
            description: "Caller-owned external identifier",
          }),
        ),
        visibility: t.Optional(visibilitySchema()),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, ...body } = input as {
        objectType: string;
      } & BwmCreateRecordInput;
      return call(() =>
        idempotentClientFor(ctx).createRecord(objectType, body),
      );
    },
  });

  rl.registerAction("records.update", {
    access: "write",
    description: `Update a record and return its envelope. Only named fields change; null clears a nullable field. Relationships take { add, remove, replace } per key, or a bare id / id array as shorthand for replace, or null to clear; HAS_ONE never holds more than one value; at most 25 link changes per request. archived: false restores an archived record. ${READ_DEFINITIONS_FIRST} Updates are compare-and-set; a lost race (409 write_conflict) is retried once automatically.`,
    inputSchema: t.Object(
      {
        objectType: objectTypeSchema(),
        id: idSchema("Record id"),
        fields: t.Optional(fieldsWriteSchema("Field key -> bare value")),
        relationships: t.Optional(relationshipsUpdateSchema()),
        externalId: t.Optional(
          t.Union([t.String({ maxLength: 500 }), t.Null()]),
        ),
        visibility: t.Optional(visibilitySchema()),
        archived: t.Optional(
          t.Boolean({ description: "true archives, false restores" }),
        ),
      },
      { additionalProperties: false, minProperties: 3 },
    ),
    async execute(input, ctx) {
      const { objectType, id, ...body } = input as {
        objectType: string;
        id: string;
      } & BwmUpdateRecordInput;
      return call(() =>
        withConflictRetry(() =>
          clientFor(ctx).updateRecord(objectType, id, body),
        ),
      );
    },
  });

  rl.registerAction("records.archive", {
    access: "write",
    description:
      "Archive a record (soft delete). It leaves default listings, stays readable with includeArchived, and records.update({ archived: false }) restores it. Nothing is destroyed. Returns the archived envelope.",
    inputSchema: t.Object(
      { objectType: objectTypeSchema(), id: idSchema("Record id") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, id } = input as { objectType: string; id: string };
      return call(() => clientFor(ctx).archiveRecord(objectType, id));
    },
  });

  rl.registerAction("records.history", {
    access: "read",
    description:
      'Values of one field over time, newest first, consecutive duplicates collapsed: { data: [{ value, valueType, displayValue, recordedAt, isCreate }], hasMore, nextCursor }. Every field has history, system and custom alike. Use it for "what changed on X and when".',
    inputSchema: t.Object(
      {
        objectType: objectTypeSchema(),
        id: idSchema("Record id"),
        field: t.String({
          minLength: 1,
          description: "Field key, e.g. $name, $stage, tier",
        }),
        limit: t.Optional(
          t.Integer({ minimum: 1, maximum: 100, description: "Default 20" }),
        ),
        after: t.Optional(
          t.String({
            minLength: 1,
            description: "nextCursor from a prior page",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, id, field, limit, after } = input as {
        objectType: string;
        id: string;
        field: string;
        limit?: number;
        after?: string;
      };
      return call(() =>
        clientFor(ctx).getFieldHistory(objectType, id, field, { limit, after }),
      );
    },
  });

  rl.registerAction("records.links", {
    access: "read",
    description:
      "Raw edges touching a record: { outbound: [link], inbound: [link] } where link = { id, fromRecordId, toRecordId, fromObjectType, toObjectType, key, role, attributes, declared, createdAt }. declared is false for an edge no definition covers. Edges whose far end the caller cannot see are hidden.",
    inputSchema: t.Object(
      {
        id: idSchema("Record id"),
        direction: t.Optional(
          t.Union([t.Literal("in"), t.Literal("out"), t.Literal("both")], {
            description: "Default both",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, direction } = input as {
        id: string;
        direction?: "in" | "out" | "both";
      };
      return call(() => clientFor(ctx).listLinks(id, direction));
    },
  });

  rl.registerAction("records.changeEvents", {
    access: "read",
    description:
      "Immutable change events for a record: [{ id, recordId, actor: { type, id }, action: created | updated, before, after, importRunId, createdAt }]. before/after are whole-record snapshots. Prefer records.history when only one field matters.",
    inputSchema: t.Object({ id: idSchema("Record id") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return call(() => clientFor(ctx).listChangeEvents(id));
    },
  });

  rl.registerAction("records.merge", {
    access: "write",
    description:
      "Fold a duplicate record into a primary of the same object type in one transaction. Fields keep the primary's value unless it is empty or fieldResolutions names 'duplicate' or a literal { value }; multi-value fields union; every edge, identity, list membership, file, and reader moves to the primary; the duplicate archives with mergedIntoId. Returns { merge: { id, status, summary }, primary, summary }.",
    inputSchema: t.Object(
      {
        objectType: objectTypeSchema(),
        primaryId: idSchema("Record that survives"),
        duplicateId: idSchema("Record folded into the primary"),
        fieldResolutions: t.Optional(
          t.Record(
            t.String(),
            t.Union([
              t.Literal("primary"),
              t.Literal("duplicate"),
              t.Object({ value: t.Unknown() }, STRICT_OBJECT),
            ]),
            {
              description:
                "Per field key: keep primary, take duplicate, or set a literal value",
            },
          ),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { objectType, ...body } = input as {
        objectType: string;
      } & BwmMergeInput;
      return call(() =>
        idempotentClientFor(ctx).mergeRecords(objectType, body),
      );
    },
  });

  rl.registerAction("merges.get", {
    access: "read",
    description:
      "Read a past merge by id: { id, objectType, primaryId, duplicateId, status: done | failed, summary: { fieldWriteCount, repointedCount, warnings }, createdAt }.",
    inputSchema: t.Object({ id: idSchema("Merge id") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      return call(() => clientFor(ctx).getMerge(id));
    },
  });
}
