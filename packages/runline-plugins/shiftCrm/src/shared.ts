import * as t from "typebox";
import {
  cursorSchema,
  enumSchema,
  idSchema,
  timestampSchema,
} from "../../_shared/shiftCloud.js";

export {
  type Ctx,
  enumSchema,
  idSchema,
  listParams,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
  withQuery,
} from "../../_shared/shiftCloud.js";

export const CRM_BASE = "/v1/crm";

export const CRM_ACCESS_ROLE = ["user", "admin"] as const;
export const CRM_RECORD_TYPE = [
  "account",
  "person",
  "opportunity",
  "activity",
  "task",
] as const;
export const CRM_IDENTITY_KIND = [
  "email",
  "phone",
  "whatsapp",
  "linkedin",
  "other",
] as const;
export const CRM_PIPELINE_OUTCOME = ["open", "won", "lost"] as const;
export const CRM_TASK_STATUS = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export const CRM_TASK_PRIORITY = ["low", "medium", "high", "urgent"] as const;
export const CRM_ACTIVITY_DIRECTION = [
  "inbound",
  "outbound",
  "internal",
] as const;
export const CRM_ACTIVITY_STATUS = [
  "planned",
  "completed",
  "cancelled",
] as const;
export const CRM_PROPERTY_DATA_TYPE = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "multi_enum",
  "json",
] as const;

export type CrmActorType = "user" | "service";

export interface CrmExternalRef {
  id: string;
  recordId: string;
  sourceSystem: string;
  sourceId: string;
  sourceUrl?: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CrmRelationship {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  relationshipType: string;
  role?: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CrmRecordBase {
  id: string;
  recordType: (typeof CRM_RECORD_TYPE)[number];
  ownerId?: string;
  customProperties: Record<string, unknown>;
  externalRefs: CrmExternalRef[];
  relationships: CrmRelationship[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CrmAccount extends CrmRecordBase {
  recordType: "account";
  name: string;
  domain?: string;
  accountType?: string;
  lifecycleStage?: string;
}

export interface CrmPersonIdentity {
  id: string;
  personId: string;
  kind: (typeof CRM_IDENTITY_KIND)[number];
  value: string;
  normalizedValue: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrmAccountPerson {
  id: string;
  accountId: string;
  personId: string;
  title?: string;
  role?: string;
  isPrimary: boolean;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmPerson extends CrmRecordBase {
  recordType: "person";
  name: string;
  identities: CrmPersonIdentity[];
  accounts: CrmAccountPerson[];
}

export interface CrmPipelineStage {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  position: number;
  outcome: (typeof CRM_PIPELINE_OUTCOME)[number];
  defaultProbability?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmPipeline {
  id: string;
  name: string;
  recordType: "opportunity";
  isDefault: boolean;
  stages: CrmPipelineStage[];
  createdAt: string;
  updatedAt: string;
}

export interface CrmOpportunity extends CrmRecordBase {
  recordType: "opportunity";
  accountId?: string;
  pipelineId: string;
  stageId: string;
  title: string;
  amount?: number;
  currency?: string;
  probability?: number;
  expectedCloseAt?: string;
  nextStep?: string;
  closeReason?: string;
}

export interface CrmActivity extends CrmRecordBase {
  recordType: "activity";
  activityType: string;
  channel?: string;
  direction?: (typeof CRM_ACTIVITY_DIRECTION)[number];
  status: (typeof CRM_ACTIVITY_STATUS)[number];
  subject: string;
  body: string;
  startedAt?: string;
  endedAt?: string;
  externalKey?: string;
}

export interface CrmTask extends CrmRecordBase {
  recordType: "task";
  title: string;
  status: (typeof CRM_TASK_STATUS)[number];
  priority: (typeof CRM_TASK_PRIORITY)[number];
  dueAt?: string;
  assignedTo?: string;
}

export type CrmRecord =
  | CrmAccount
  | CrmPerson
  | CrmOpportunity
  | CrmActivity
  | CrmTask;

export interface CrmAccessGrant {
  id: string;
  userId: string;
  role: (typeof CRM_ACCESS_ROLE)[number];
  grantedByType: CrmActorType;
  grantedById: string;
  createdAt: string;
  revokedAt?: string;
  revokedByType?: CrmActorType;
  revokedById?: string;
}

export interface CrmChangeEvent {
  id: string;
  recordId: string;
  actorType: CrmActorType;
  actorId: string;
  action: "created" | "updated";
  before?: unknown;
  after: unknown;
  importRunId?: string;
  createdAt: string;
}

export interface CrmPropertyDefinition {
  id: string;
  recordType: (typeof CRM_RECORD_TYPE)[number];
  key: string;
  label: string;
  dataType: (typeof CRM_PROPERTY_DATA_TYPE)[number];
  options: string[];
  validation: Record<string, unknown>;
  filterable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrmImportRun {
  id: string;
  sourceSystem: string;
  status: "staged" | "committing" | "committed" | "failed" | "cancelled";
  startedByType: CrmActorType;
  startedById: string;
  summary: Record<string, unknown>;
  committedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmImportRow {
  id: string;
  importRunId: string;
  sourceId: string;
  recordType: (typeof CRM_RECORD_TYPE)[number];
  rawPayload: unknown;
  transformedPayload?: unknown;
  status: "pending" | "imported" | "invalid" | "conflict" | "skipped";
  errors: string[];
  recordId?: string;
  createdAt: string;
  updatedAt: string;
}

function propertiesSchema(description: string) {
  return t.Record(t.String(), t.Unknown(), { description });
}

function externalRefSchema() {
  return t.Object(
    {
      sourceSystem: t.String({
        minLength: 1,
        maxLength: 100,
        pattern: "\\S",
        description: "Upstream system name, e.g. hubspot",
      }),
      sourceId: t.String({
        minLength: 1,
        maxLength: 500,
        pattern: "\\S",
        description: "Stable ID in the upstream system",
      }),
      sourceUrl: t.Optional(t.String({ minLength: 1, maxLength: 2_000 })),
      attributes: t.Optional(propertiesSchema("Source-specific attributes")),
    },
    { additionalProperties: false },
  );
}

function relationshipSchema() {
  return t.Object(
    {
      toRecordId: idSchema("Target CRM record ID"),
      relationshipType: t.String({
        minLength: 1,
        maxLength: 100,
        pattern: "\\S",
        description: "Relationship type, e.g. participant, attendee, subject",
      }),
      role: t.Optional(
        t.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
      ),
      attributes: t.Optional(propertiesSchema("Governed link attributes")),
    },
    { additionalProperties: false },
  );
}

/** Shared create-time record fields (owner, custom properties, links). */
export function createRecordFields() {
  return {
    ownerId: t.Optional(idSchema("Owning Shift user ID")),
    customProperties: t.Optional(
      propertiesSchema(
        "Governed custom properties; every key must have a property definition",
      ),
    ),
    externalRefs: t.Optional(t.Array(externalRefSchema())),
    relationships: t.Optional(t.Array(relationshipSchema())),
  };
}

/** Shared update-time record fields (tri-state PATCH semantics). */
export function updateRecordFields() {
  return {
    ownerId: t.Optional(t.Union([idSchema("Owning Shift user ID"), t.Null()])),
    customProperties: t.Optional(
      propertiesSchema("Replacement governed custom properties"),
    ),
    externalRefs: t.Optional(t.Array(externalRefSchema())),
    relationships: t.Optional(t.Array(relationshipSchema())),
    archived: t.Optional(t.Boolean({ description: "Archive or restore" })),
  };
}

export function paginationFields(maxLimit = 200) {
  return {
    cursor: t.Optional(cursorSchema()),
    limit: t.Optional(
      t.Integer({
        minimum: 1,
        maximum: maxLimit,
        description: "Max results, default 50",
      }),
    ),
  };
}

export function recordTypeSchema(description = "CRM record type") {
  return enumSchema(description, CRM_RECORD_TYPE);
}

export function assertTimeOrder(
  start: unknown,
  end: unknown,
  message: string,
): void {
  if (typeof start === "string" && typeof end === "string" && start > end) {
    throw new Error(message);
  }
}

export function nullableTimestamp(description: string) {
  return t.Optional(t.Union([timestampSchema(description), t.Null()]));
}
