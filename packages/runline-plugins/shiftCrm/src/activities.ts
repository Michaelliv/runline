import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  assertTimeOrder,
  CRM_ACTIVITY_DIRECTION,
  CRM_ACTIVITY_STATUS,
  CRM_BASE,
  type CrmActivity,
  createRecordFields,
  enumSchema,
  idSchema,
  listParams,
  paginationFields,
  request,
  STRICT_OBJECT,
  timestampSchema,
  withQuery,
} from "./shared.js";

const activityListFields = {
  linkedRecordId: t.Optional(idSchema("Filter by linked CRM record ID")),
  status: t.Optional(enumSchema("Activity status", CRM_ACTIVITY_STATUS)),
  ...paginationFields(),
};

export function registerActivityActions(rl: RunlinePluginAPI) {
  rl.registerAction("activity.list", {
    access: "read",
    description: "List the first page of CRM activities.",
    inputSchema: t.Object(activityListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ activities: CrmActivity[] }>(
        ctx,
        withQuery(`${CRM_BASE}/activities`, listParams(input)),
      );
      return body.activities;
    },
  });

  rl.registerAction("activity.listPage", {
    access: "read",
    description: "List a cursor-paginated page of CRM activities.",
    inputSchema: t.Object(activityListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ activities: CrmActivity[]; nextCursor?: string }>(
        ctx,
        withQuery(`${CRM_BASE}/activities`, listParams(input)),
      );
    },
  });

  rl.registerAction("activity.log", {
    access: "write",
    description:
      "Log an append-only CRM activity (call, meeting, message, note). Must link to at least one CRM record via relationships.",
    inputSchema: t.Object(
      {
        activityType: t.String({
          minLength: 1,
          maxLength: 100,
          pattern: "\\S",
          description: "Activity type, e.g. call, meeting, note",
        }),
        channel: t.Optional(
          t.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
        ),
        direction: t.Optional(
          enumSchema("Activity direction", CRM_ACTIVITY_DIRECTION),
        ),
        status: t.Optional(enumSchema("Activity status", CRM_ACTIVITY_STATUS)),
        subject: t.String({
          minLength: 1,
          maxLength: 500,
          pattern: "\\S",
          description: "Activity subject",
        }),
        body: t.Optional(t.String({ maxLength: 100_000 })),
        startedAt: t.Optional(timestampSchema("ISO-8601 start timestamp")),
        endedAt: t.Optional(timestampSchema("ISO-8601 end timestamp")),
        externalKey: t.Optional(
          t.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
        ),
        ...createRecordFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as {
        relationships?: unknown[];
        startedAt?: string;
        endedAt?: string;
      };
      if (!fields.relationships || fields.relationships.length === 0) {
        throw new Error(
          "An activity must link to at least one CRM record via relationships",
        );
      }
      assertTimeOrder(
        fields.startedAt,
        fields.endedAt,
        "Activity endedAt must not precede startedAt",
      );
      const body = await request<{ activity: CrmActivity }>(
        ctx,
        `${CRM_BASE}/activities`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.activity;
    },
  });
}
