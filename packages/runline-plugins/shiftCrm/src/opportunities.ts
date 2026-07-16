import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_BASE,
  CRM_PIPELINE_OUTCOME,
  type CrmOpportunity,
  type CrmPipeline,
  createRecordFields,
  enumSchema,
  idSchema,
  listParams,
  nullableTimestamp,
  paginationFields,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
  updateRecordFields,
  withQuery,
} from "./shared.js";

const opportunityListFields = {
  accountId: t.Optional(idSchema("Filter by account record ID")),
  pipelineId: t.Optional(idSchema("Filter by pipeline ID")),
  stageId: t.Optional(idSchema("Filter by stage ID")),
  includeArchived: t.Optional(t.Boolean()),
  ...paginationFields(),
};

const probabilitySchema = t.Integer({
  minimum: 0,
  maximum: 100,
  description: "Win probability percent",
});

export function registerPipelineActions(rl: RunlinePluginAPI) {
  rl.registerAction("pipeline.list", {
    access: "read",
    description: "List CRM opportunity pipelines with their ordered stages.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ pipelines: CrmPipeline[] }>(
        ctx,
        `${CRM_BASE}/pipelines`,
      );
      return body.pipelines;
    },
  });

  rl.registerAction("pipeline.get", {
    access: "read",
    description: "Get a CRM pipeline and its stages by ID.",
    inputSchema: t.Object({ id: idSchema("Pipeline ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ pipeline: CrmPipeline }>(
        ctx,
        `${CRM_BASE}/pipelines/${pathSegment(id)}`,
      );
      return body.pipeline;
    },
  });

  rl.registerAction("pipeline.create", {
    access: "write",
    description:
      "Create a CRM opportunity pipeline with ordered stages. Requires a CRM admin grant.",
    inputSchema: t.Object(
      {
        name: t.String({
          minLength: 1,
          maxLength: 200,
          pattern: "\\S",
          description: "Pipeline name",
        }),
        isDefault: t.Optional(t.Boolean()),
        stages: t.Array(
          t.Object(
            {
              key: t.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
              name: t.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
              position: t.Integer({ minimum: 0 }),
              outcome: t.Optional(
                enumSchema("Stage outcome", CRM_PIPELINE_OUTCOME),
              ),
              defaultProbability: t.Optional(probabilitySchema),
            },
            { additionalProperties: false },
          ),
          { minItems: 1 },
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { stages } = input as {
        stages: Array<{ key: string; position: number }>;
      };
      if (new Set(stages.map((s) => s.key)).size !== stages.length) {
        throw new Error("Duplicate pipeline stage key");
      }
      if (new Set(stages.map((s) => s.position)).size !== stages.length) {
        throw new Error("Duplicate pipeline stage position");
      }
      const body = await request<{ pipeline: CrmPipeline }>(
        ctx,
        `${CRM_BASE}/pipelines`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.pipeline;
    },
  });
}

export function registerOpportunityActions(rl: RunlinePluginAPI) {
  rl.registerAction("opportunity.list", {
    access: "read",
    description: "List the first page of CRM opportunities.",
    inputSchema: t.Object(opportunityListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ opportunities: CrmOpportunity[] }>(
        ctx,
        withQuery(`${CRM_BASE}/opportunities`, listParams(input)),
      );
      return body.opportunities;
    },
  });

  rl.registerAction("opportunity.listPage", {
    access: "read",
    description: "List a cursor-paginated page of CRM opportunities.",
    inputSchema: t.Object(opportunityListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ opportunities: CrmOpportunity[]; nextCursor?: string }>(
        ctx,
        withQuery(`${CRM_BASE}/opportunities`, listParams(input)),
      );
    },
  });

  rl.registerAction("opportunity.get", {
    access: "read",
    description: "Get a CRM opportunity by record ID.",
    inputSchema: t.Object(
      { id: idSchema("Opportunity record ID") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ opportunity: CrmOpportunity }>(
        ctx,
        `${CRM_BASE}/opportunities/${pathSegment(id)}`,
      );
      return body.opportunity;
    },
  });

  rl.registerAction("opportunity.create", {
    access: "write",
    description:
      "Create a CRM opportunity in a pipeline stage. accountId may be omitted while attribution is unresolved.",
    inputSchema: t.Object(
      {
        accountId: t.Optional(idSchema("Account record ID")),
        pipelineId: idSchema("Pipeline ID"),
        stageId: idSchema("Stage ID (must belong to the pipeline)"),
        title: t.String({
          minLength: 1,
          maxLength: 500,
          pattern: "\\S",
          description: "Opportunity title",
        }),
        amount: t.Optional(t.Number({ minimum: 0 })),
        currency: t.Optional(
          t.String({ minLength: 1, maxLength: 10, pattern: "\\S" }),
        ),
        probability: t.Optional(probabilitySchema),
        expectedCloseAt: t.Optional(
          timestampSchema("ISO-8601 expected close timestamp"),
        ),
        nextStep: t.Optional(t.String({ maxLength: 50_000 })),
        closeReason: t.Optional(t.String({ maxLength: 10_000 })),
        ...createRecordFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ opportunity: CrmOpportunity }>(
        ctx,
        `${CRM_BASE}/opportunities`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.opportunity;
    },
  });

  rl.registerAction("opportunity.update", {
    access: "write",
    description:
      "Update or archive a CRM opportunity, including moving it to another stage of its pipeline.",
    inputSchema: t.Object(
      {
        id: idSchema("Opportunity record ID"),
        stageId: t.Optional(idSchema("Stage ID within the same pipeline")),
        title: t.Optional(
          t.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
        ),
        amount: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
        currency: t.Optional(
          t.Union([
            t.String({ minLength: 1, maxLength: 10, pattern: "\\S" }),
            t.Null(),
          ]),
        ),
        probability: t.Optional(t.Union([probabilitySchema, t.Null()])),
        expectedCloseAt: nullableTimestamp("ISO-8601 expected close timestamp"),
        nextStep: t.Optional(
          t.Union([t.String({ maxLength: 50_000 }), t.Null()]),
        ),
        closeReason: t.Optional(
          t.Union([t.String({ maxLength: 10_000 }), t.Null()]),
        ),
        ...updateRecordFields(),
      },
      STRICT_UPDATE_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ opportunity: CrmOpportunity }>(
        ctx,
        `${CRM_BASE}/opportunities/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.opportunity;
    },
  });
}
