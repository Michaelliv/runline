export {
  type Ctx,
  cursorSchema,
  enumSchema,
  idSchema,
  listParams,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  withQuery,
} from "../../_shared/shiftCloud.js";

/** Base path of the operational graph service in the Shift cloud API. */
export const ATLAS_BASE = "/v1/services/operational-graph";

export const GRAPH_ACTOR_KIND = ["agent", "human_role"] as const;
export const GRAPH_JOURNEY_STATUS = ["draft", "published", "retired"] as const;
export const GRAPH_ASSIGNMENT_ROLE = [
  "does",
  "approves",
  "consulted",
  "informed",
] as const;
export const GRAPH_RELATION_KIND = ["follows", "triggers"] as const;
export const GRAPH_TASK_MODE = ["ai", "human", "hybrid"] as const;
export const GRAPH_BINDING_EXECUTOR = ["vex", "external", "manual"] as const;
export const GRAPH_BINDING_STATUS = ["planned", "live", "paused"] as const;
export const GRAPH_EVIDENCE_KIND = ["report", "artifact", "dashboard"] as const;
export const GRAPH_CHANGE_ENTITY_TYPE = [
  "actor",
  "line",
  "journey",
  "stage",
  "task",
  "assignment",
  "relation",
  "binding",
  "evidence",
  "labels",
] as const;
