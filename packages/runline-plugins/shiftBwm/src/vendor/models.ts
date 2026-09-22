/**
 * SYNCED_FROM shift-labs-ai/cloud@42c9f13
 *   packages/business-world-model-service/src/models.ts
 *
 * Verbatim copy; only the import paths are rewritten. Do not edit here.
 */
/**
 * Public API shape: record envelopes, definitions, write inputs, queries.
 * Browser-safe (Zod only).
 */
import {
  BWM_CARDINALITIES,
  BWM_HISTORY_DEFAULT_LIMIT,
  BWM_HISTORY_MAX_LIMIT,
  BWM_LIST_DEFAULT_LIMIT,
  BWM_LIST_MAX_LIMIT,
  BWM_SOCIAL_HANDLE_SERVICES,
  BWM_VALUE_TYPES,
  BWM_VISIBILITY_MODES,
} from "./contracts.js";
import { z } from "zod";

export const BwmValueType = z.enum(BWM_VALUE_TYPES);
export const BwmCardinality = z.enum(BWM_CARDINALITIES);
export const BwmVisibilityMode = z.enum(BWM_VISIBILITY_MODES);
export const BwmSocialHandleService = z.enum(BWM_SOCIAL_HANDLE_SERVICES);
export const BwmPrincipalType = z.enum(["user", "service"]);

export const BwmPrincipalRef = z.object({
  type: BwmPrincipalType,
  id: z.string().min(1),
});

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(100);
/** `$system` or bare custom slug. */
const fieldKey = z.string().regex(/^\$?[a-zA-Z][a-zA-Z0-9_-]*$/);

export const BwmSelectOption = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  parentId: z.string().optional(),
});

export const BwmTypeConfiguration = z.object({
  currency: z.string().optional(),
  handleService: BwmSocialHandleService.optional(),
  multipleValues: z.boolean().optional(),
  unique: z.boolean().optional(),
  options: z.array(BwmSelectOption).optional(),
  parentFieldKey: z.string().optional(),
});

export const BwmFieldDefinition = z.object({
  id: z.string().nullable(),
  slug: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  valueType: BwmValueType,
  system: z.boolean(),
  readOnly: z.boolean(),
  required: z.boolean(),
  typeConfiguration: BwmTypeConfiguration,
});

export const BwmRelationshipDefinition = z.object({
  id: z.string().nullable(),
  slug: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  system: z.boolean(),
  readOnly: z.boolean(),
  cardinality: BwmCardinality,
  objectType: z.string(),
  inverseKey: z.string().nullable(),
});

export const BwmDefinitions = z.object({
  objectType: z.string(),
  fieldDefinitions: z.record(z.string(), BwmFieldDefinition),
  relationshipDefinitions: z.record(z.string(), BwmRelationshipDefinition),
});

export const BwmObjectType = z.object({
  slug: z.string(),
  label: z.string(),
  pluralLabel: z.string(),
  description: z.string().nullable(),
  system: z.boolean(),
  path: z.string(),
});

export const BwmVisibility = z.object({
  mode: BwmVisibilityMode,
  groups: z.array(z.string()),
  principals: z.array(BwmPrincipalRef),
});

export const BwmFieldValue = z.object({
  value: z.unknown(),
  valueType: BwmValueType,
});

export const BwmRelationshipValue = z.object({
  cardinality: BwmCardinality,
  objectType: z.string(),
  values: z.array(z.string()),
});

export const BwmRecord = z.object({
  id: z.string(),
  objectType: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  mergedIntoId: z.string().nullable(),
  externalId: z.string().nullable(),
  visibility: BwmVisibility,
  fields: z.record(z.string(), BwmFieldValue),
  relationships: z.record(z.string(), BwmRelationshipValue),
});

export const BwmRecordPage = z.object({
  data: z.array(BwmRecord),
  object: z.literal("list"),
  totalCount: z.number().int().nonnegative(),
});

// ─── writes ──────────────────────────────────────────────────────

const idOrIds = z.union([z.string().min(1), z.array(z.string().min(1))]);

export const BwmRelationshipOps = z
  .object({
    add: idOrIds.optional(),
    remove: idOrIds.optional(),
    replace: idOrIds.nullable().optional(),
  })
  .strict();

export const BwmVisibilityInput = z.object({
  mode: BwmVisibilityMode,
  groups: z.array(z.string().min(1)).default([]),
  principals: z.array(BwmPrincipalRef).default([]),
});

export const BwmCreateRecordInput = z.object({
  fields: z.record(fieldKey, z.unknown()).default({}),
  relationships: z.record(fieldKey, idOrIds).default({}),
  externalId: z.string().trim().min(1).max(500).optional(),
  visibility: BwmVisibilityInput.optional(),
});

export const BwmUpdateRecordInput = z.object({
  fields: z.record(fieldKey, z.unknown()).optional(),
  relationships: z
    .record(fieldKey, z.union([idOrIds, z.null(), BwmRelationshipOps]))
    .optional(),
  externalId: z.string().trim().max(500).nullish(),
  visibility: BwmVisibilityInput.optional(),
  archived: z.boolean().optional(),
});

export const BwmCreateObjectTypeInput = z.object({
  slug,
  label: z.string().trim().min(1).max(200),
  pluralLabel: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(2_000).optional(),
});

export const BwmCreateFieldInput = z
  .object({
    key: slug,
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000).optional(),
    valueType: BwmValueType,
    options: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(200).optional(),
          label: z.string().trim().min(1).max(500),
          description: z.string().trim().max(2_000).optional(),
        }),
      )
      .default([]),
    validation: z
      .object({
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().nonnegative().optional(),
        minimum: z.number().finite().optional(),
        maximum: z.number().finite().optional(),
        pattern: z.string().max(1_000).optional(),
      })
      .strict()
      .default({}),
    typeConfiguration: z
      .object({
        currency: z.string().trim().length(3).optional(),
        handleService: BwmSocialHandleService.optional(),
        multipleValues: z.boolean().optional(),
        unique: z.boolean().optional(),
      })
      .strict()
      .default({}),
    filterable: z.boolean().default(true),
  })
  .superRefine((input, context) => {
    const isSelect =
      input.valueType === "SINGLE_SELECT" || input.valueType === "MULTI_SELECT";
    if (isSelect && input.options.length === 0) {
      context.addIssue({ code: "custom", message: "select_options_required" });
    }
    if (!isSelect && input.options.length > 0) {
      context.addIssue({
        code: "custom",
        message: "select_options_not_allowed",
      });
    }
    const labels = input.options.map((option) => option.label);
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "duplicate_select_option" });
    }
    if (input.validation.pattern !== undefined) {
      try {
        new RegExp(input.validation.pattern);
      } catch {
        context.addIssue({ code: "custom", message: "pattern_invalid" });
      }
    }
    const {
      minLength: minL,
      maxLength: maxL,
      minimum,
      maximum,
    } = input.validation;
    if (minL !== undefined && maxL !== undefined && minL > maxL) {
      context.addIssue({ code: "custom", message: "length_range_invalid" });
    }
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      context.addIssue({ code: "custom", message: "number_range_invalid" });
    }
    const textual =
      input.valueType === "TEXT" || input.valueType === "MARKDOWN";
    if (
      !textual &&
      (minL !== undefined || maxL !== undefined || input.validation.pattern)
    ) {
      context.addIssue({
        code: "custom",
        message: "string_validation_not_allowed",
      });
    }
    const numeric =
      input.valueType === "NUMBER" || input.valueType === "CURRENCY";
    if (!numeric && (minimum !== undefined || maximum !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "number_validation_not_allowed",
      });
    }
    if (
      input.valueType === "SOCIAL_HANDLE" &&
      !input.typeConfiguration.handleService
    ) {
      context.addIssue({ code: "custom", message: "handle_service_required" });
    }
  });

export const BwmCreateRelationshipDefinitionInput = z.object({
  key: slug,
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000).optional(),
  objectType: slug,
  cardinality: BwmCardinality.default("HAS_MANY"),
  /** Read-only `HAS_MANY` key exposed on the target type. */
  inverseKey: slug.optional(),
});

export const BwmCreatePipelineInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    isDefault: z.boolean().default(false),
    stages: z
      .array(
        z.object({
          key: slug,
          name: z.string().trim().min(1).max(200),
          position: z.number().int().nonnegative(),
          outcome: z.enum(["open", "won", "lost"]).default("open"),
          defaultProbability: z.number().int().min(0).max(100).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((input, context) => {
    const keys = input.stages.map((stage) => stage.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "duplicate_stage_key" });
    }
    const positions = input.stages.map((stage) => stage.position);
    if (new Set(positions).size !== positions.length) {
      context.addIssue({ code: "custom", message: "duplicate_stage_position" });
    }
  });

export const BwmPipeline = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  stages: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      position: z.number().int(),
      outcome: z.enum(["open", "won", "lost"]),
      defaultProbability: z.number().int().nullable(),
    }),
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── queries ─────────────────────────────────────────────────────

export const BwmFilterOperator = z.enum([
  "equal",
  "startsWith",
  "contains",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);

export const BwmFilter = z.object({
  key: z.string().min(1),
  operator: BwmFilterOperator.optional(),
  negate: z.boolean().default(false),
  value: z.string(),
});

export const BwmListQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BWM_LIST_MAX_LIMIT)
    .default(BWM_LIST_DEFAULT_LIMIT),
  offset: z.coerce.number().int().nonnegative().default(0),
  includeArchived: z.boolean().default(false),
  filters: z.array(BwmFilter).default([]),
});

export const BwmHistoryQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BWM_HISTORY_MAX_LIMIT)
    .default(BWM_HISTORY_DEFAULT_LIMIT),
  after: z.string().min(1).optional(),
});

export const BwmFieldHistoryEntry = z.object({
  value: z.unknown(),
  valueType: BwmValueType,
  displayValue: z.string(),
  recordedAt: z.string().datetime(),
  isCreate: z.boolean(),
});

export const BwmFieldHistory = z.object({
  data: z.array(BwmFieldHistoryEntry),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export const BwmLinkDirection = z.enum(["in", "out", "both"]);

// ─── lists, groups, merges, members ──────────────────────────────

export const BwmList = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  fields: z.object({
    $name: BwmFieldValue,
    $objectType: BwmFieldValue,
    $description: BwmFieldValue,
  }),
  relationships: z.object({ $records: BwmRelationshipValue }),
});

export const BwmCreateListInput = z.object({
  fields: z.object({
    $name: z.string().trim().min(1).max(200),
    $objectType: z.string().min(1),
    $description: z.string().trim().max(2_000).nullish(),
  }),
  relationships: z.object({ $records: idOrIds.optional() }).default({}),
});

export const BwmUpdateListInput = z.object({
  fields: z
    .object({
      $name: z.string().trim().min(1).max(200).optional(),
      $description: z.string().trim().max(2_000).nullish(),
    })
    .optional(),
  relationships: z
    .object({ $records: z.union([idOrIds, BwmRelationshipOps]).optional() })
    .optional(),
  archived: z.boolean().optional(),
});

export const BwmGroup = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(BwmPrincipalRef),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BwmCreateGroupInput = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000).optional(),
  members: z.array(BwmPrincipalRef).default([]),
});

export const BwmUpdateGroupInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).nullish(),
});

export const BwmGroupMembersInput = z
  .object({
    add: z.array(BwmPrincipalRef).default([]),
    remove: z.array(BwmPrincipalRef).default([]),
  })
  .refine(
    (input) => input.add.length > 0 || input.remove.length > 0,
    "group_members_empty",
  );

export const BwmMergeInput = z.object({
  primaryId: z.string().min(1),
  duplicateId: z.string().min(1),
  fieldResolutions: z
    .record(
      fieldKey,
      z.union([
        z.literal("primary"),
        z.literal("duplicate"),
        z.object({ value: z.unknown() }),
      ]),
    )
    .default({}),
  options: z.object({ multiSelectUnion: z.boolean().default(true) }).default({
    multiSelectUnion: true,
  }),
});

export const BwmMerge = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  objectType: z.string(),
  primaryId: z.string(),
  duplicateId: z.string(),
  status: z.enum(["done", "failed"]),
  summary: z.object({
    fieldWriteCount: z.number().int(),
    repointedCount: z.number().int(),
    warnings: z.array(z.string()),
  }),
});

export const BwmMergeResult = z.object({
  merge: BwmMerge,
  primary: BwmRecord,
  summary: BwmMerge.shape.summary,
});

export const BwmMember = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  fields: z.object({
    $name: BwmFieldValue,
    $email: BwmFieldValue,
    $role: BwmFieldValue,
  }),
});

export const BwmMemberPage = z.object({
  data: z.array(BwmMember),
  object: z.literal("list"),
  totalCount: z.number().int(),
});

export const BwmChangeEvent = z.object({
  id: z.string(),
  recordId: z.string(),
  actor: BwmPrincipalRef,
  action: z.enum(["created", "updated"]),
  before: z.unknown().optional(),
  after: z.unknown(),
  importRunId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const BwmLink = z.object({
  id: z.string(),
  fromRecordId: z.string(),
  toRecordId: z.string(),
  fromObjectType: z.string(),
  toObjectType: z.string(),
  key: z.string(),
  role: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  declared: z.boolean(),
  createdAt: z.string().datetime(),
});

export const BwmLinks = z.object({
  outbound: z.array(BwmLink),
  inbound: z.array(BwmLink),
});

export const BwmFileUploadInput = z.object({
  filename: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});

export const BwmFile = z.object({
  id: z.string(),
  filename: z.string().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(["PENDING", "COMPLETED", "ARCHIVED"]),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

/** A file plus its one-time upload grant; `expiresAt` is the grant's. */
export const BwmFileUpload = BwmFile.extend({
  uploadUrl: z.string(),
  uploadMethod: z.string(),
  uploadHeaders: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});

export const BwmFileUrl = z.object({
  url: z.string(),
  expiresAt: z.string().datetime(),
});

// ─── imports (Shift protocol, unchanged) ─────────────────────────

export const BwmCreateImportRunInput = z.object({
  sourceSystem: z.string().trim().min(1).max(100),
});

export const BwmStageImportRowsInput = z.object({
  rows: z
    .array(
      z.object({
        sourceId: z.string().trim().min(1).max(500),
        objectType: slug,
        rawPayload: z.json(),
      }),
    )
    .min(1)
    .max(500),
});

export const BwmCommitImportRowInput = z.object({
  transformedPayload: z.json(),
});

export type BwmValueType = z.infer<typeof BwmValueType>;
export type BwmCardinality = z.infer<typeof BwmCardinality>;
export type BwmVisibilityMode = z.infer<typeof BwmVisibilityMode>;
export type BwmPrincipalRef = z.infer<typeof BwmPrincipalRef>;
export type BwmSelectOption = z.infer<typeof BwmSelectOption>;
export type BwmTypeConfiguration = z.infer<typeof BwmTypeConfiguration>;
export type BwmFieldDefinition = z.infer<typeof BwmFieldDefinition>;
export type BwmRelationshipDefinition = z.infer<
  typeof BwmRelationshipDefinition
>;
export type BwmDefinitions = z.infer<typeof BwmDefinitions>;
export type BwmObjectType = z.infer<typeof BwmObjectType>;
export type BwmVisibility = z.infer<typeof BwmVisibility>;
export type BwmFieldValue = z.infer<typeof BwmFieldValue>;
export type BwmRelationshipValue = z.infer<typeof BwmRelationshipValue>;
export type BwmRecord = z.infer<typeof BwmRecord>;
export type BwmRecordPage = z.infer<typeof BwmRecordPage>;
export type BwmRelationshipOps = z.infer<typeof BwmRelationshipOps>;
export type BwmVisibilityInput = z.input<typeof BwmVisibilityInput>;
export type BwmCreateRecordInput = z.input<typeof BwmCreateRecordInput>;
export type BwmUpdateRecordInput = z.input<typeof BwmUpdateRecordInput>;
export type BwmCreateObjectTypeInput = z.input<typeof BwmCreateObjectTypeInput>;
export type BwmCreateFieldInput = z.input<typeof BwmCreateFieldInput>;
export type BwmCreateRelationshipDefinitionInput = z.input<
  typeof BwmCreateRelationshipDefinitionInput
>;
export type BwmCreatePipelineInput = z.input<typeof BwmCreatePipelineInput>;
export type BwmPipeline = z.infer<typeof BwmPipeline>;
export type BwmFilterOperator = z.infer<typeof BwmFilterOperator>;
export type BwmFilter = z.infer<typeof BwmFilter>;
export type BwmListQuery = z.input<typeof BwmListQuery>;
export type BwmHistoryQuery = z.input<typeof BwmHistoryQuery>;
export type BwmFieldHistoryEntry = z.infer<typeof BwmFieldHistoryEntry>;
export type BwmFieldHistory = z.infer<typeof BwmFieldHistory>;
export type BwmLinkDirection = z.infer<typeof BwmLinkDirection>;
export type BwmList = z.infer<typeof BwmList>;
export type BwmCreateListInput = z.input<typeof BwmCreateListInput>;
export type BwmUpdateListInput = z.input<typeof BwmUpdateListInput>;
export type BwmGroup = z.infer<typeof BwmGroup>;
export type BwmCreateGroupInput = z.input<typeof BwmCreateGroupInput>;
export type BwmUpdateGroupInput = z.input<typeof BwmUpdateGroupInput>;
export type BwmGroupMembersInput = z.input<typeof BwmGroupMembersInput>;
export type BwmMergeInput = z.input<typeof BwmMergeInput>;
export type BwmMerge = z.infer<typeof BwmMerge>;
export type BwmMergeResult = z.infer<typeof BwmMergeResult>;
export type BwmMember = z.infer<typeof BwmMember>;
export type BwmMemberPage = z.infer<typeof BwmMemberPage>;
export type BwmChangeEvent = z.infer<typeof BwmChangeEvent>;
export type BwmLink = z.infer<typeof BwmLink>;
export type BwmLinks = z.infer<typeof BwmLinks>;
export type BwmFileUploadInput = z.input<typeof BwmFileUploadInput>;
export type BwmFile = z.infer<typeof BwmFile>;
export type BwmFileUpload = z.infer<typeof BwmFileUpload>;
export type BwmFileUrl = z.infer<typeof BwmFileUrl>;
export type BwmCreateImportRunInput = z.input<typeof BwmCreateImportRunInput>;
export type BwmStageImportRowsInput = z.input<typeof BwmStageImportRowsInput>;
export type BwmCommitImportRowInput = z.input<typeof BwmCommitImportRowInput>;

/**
 * Parses `key[op]=value` / `key[-op]=value` / `key=value` query pairs into
 * filters. Reserved pagination keys are skipped.
 */
export function parseFilterQuery(
  entries: Iterable<[string, string]>,
): BwmFilter[] {
  const reserved = new Set(["limit", "offset", "includeArchived"]);
  const filters: BwmFilter[] = [];
  for (const [rawKey, value] of entries) {
    if (reserved.has(rawKey)) continue;
    const match = /^(.+?)(?:\[(-?)([a-zA-Z]+)\])?$/.exec(rawKey);
    if (!match) continue;
    const [, key, minus, operator] = match;
    if (!key) continue;
    const parsedOperator = operator
      ? BwmFilterOperator.safeParse(operator)
      : undefined;
    if (parsedOperator && !parsedOperator.success) continue;
    filters.push({
      key,
      operator: parsedOperator?.data,
      negate: minus === "-",
      value,
    });
  }
  return filters;
}
