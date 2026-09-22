/**
 * SYNCED_FROM shift-labs-ai/cloud
 *   packages/contracts/src/business-world-model.ts
 *   packages/contracts/src/services.ts (SERVICE_ROUTE_PREFIXES.BUSINESS_WORLD_MODEL)
 *
 * Verbatim copy of the constants the vendored client and models need.
 * Do not edit here; update the cloud source and re-copy.
 */

export const BWM_BUILT_IN_OBJECT_TYPES = [
  "account",
  "contact",
  "opportunity",
  "activity",
  "task",
  "note",
] as const;

export type BwmBuiltInObjectType = (typeof BWM_BUILT_IN_OBJECT_TYPES)[number];

/** URL segment for each built-in object type. Custom types live under `objects/{slug}`. */
export const BWM_OBJECT_TYPE_PATHS: Record<BwmBuiltInObjectType, string> = {
  account: "accounts",
  contact: "contacts",
  opportunity: "opportunities",
  activity: "activities",
  task: "tasks",
  note: "notes",
};

export const BWM_VALUE_TYPES = [
  "TEXT",
  "NUMBER",
  "CHECKBOX",
  "CURRENCY",
  "DATE",
  "DATETIME",
  "EMAIL",
  "TELEPHONE",
  "URL",
  "SOCIAL_HANDLE",
  "ADDRESS",
  "FULL_NAME",
  "MARKDOWN",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "JSON",
] as const;

export type BwmValueType = (typeof BWM_VALUE_TYPES)[number];

export const BWM_CARDINALITIES = ["HAS_ONE", "HAS_MANY"] as const;
export type BwmCardinality = (typeof BWM_CARDINALITIES)[number];

export const BWM_VISIBILITY_MODES = ["org", "group", "private"] as const;
export type BwmVisibilityMode = (typeof BWM_VISIBILITY_MODES)[number];

export const BWM_SOCIAL_HANDLE_SERVICES = [
  "TWITTER",
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
] as const;
export type BwmSocialHandleService =
  (typeof BWM_SOCIAL_HANDLE_SERVICES)[number];

/** System field and relationship keys carry this prefix; custom keys are bare slugs. */
export const BWM_SYSTEM_KEY_PREFIX = "$";

export const BWM_LIST_DEFAULT_LIMIT = 25;
export const BWM_LIST_MAX_LIMIT = 100;
export const BWM_HISTORY_DEFAULT_LIMIT = 20;
export const BWM_HISTORY_MAX_LIMIT = 100;

/** `SERVICE_ROUTE_PREFIXES.BUSINESS_WORLD_MODEL` in cloud: `/v1/services/business-world-model`. */
export const BWM_ROUTE_PREFIX = "/v1/services/business-world-model";
