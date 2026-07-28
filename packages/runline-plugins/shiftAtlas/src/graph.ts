import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  ATLAS_BASE,
  cursorSchema,
  enumSchema,
  GRAPH_ACTOR_KIND,
  GRAPH_ASSIGNMENT_ROLE,
  GRAPH_BINDING_EXECUTOR,
  GRAPH_BINDING_STATUS,
  GRAPH_CHANGE_ENTITY_TYPE,
  GRAPH_EVIDENCE_KIND,
  GRAPH_JOURNEY_STATUS,
  GRAPH_RELATION_KIND,
  GRAPH_TASK_MODE,
  idSchema,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
} from "./shared.js";

/**
 * The operational graph behind the Atlas view: a business spec of how
 * a company operates, in its own language. Four fixed levels — line →
 * journey → stage → task — plus named actors, RACI assignments,
 * level-typed relations, execution bindings, and evidence. Automation
 * status is always derived from bindings, never declared.
 */

const name = (description: string) =>
  t.String({ minLength: 1, maxLength: 300, pattern: "\\S", description });
const longText = (description: string) =>
  t.String({ maxLength: 5_000, description });
const position = t.Integer({
  minimum: 0,
  maximum: 100_000,
  description: "Sort position within the parent (0-based)",
});
const urlField = t.String({
  minLength: 1,
  maxLength: 2_000,
  description: "Link URL",
});
const referenceField = t.String({
  minLength: 1,
  maxLength: 1_000,
  pattern: "\\S",
  description: "External reference (system-specific identifier)",
});

type Fields = Record<string, object>;

export function registerGraphActions(rl: RunlinePluginAPI) {
  /* -------------------------------------------------------------- */
  /* Reads                                                          */
  /* -------------------------------------------------------------- */

  rl.registerAction("summary", {
    access: "read",
    description:
      "The operational graph's structure without task bodies: every " +
      "line, journey, and stage with rollups (total/liveAi/planned/" +
      "human counts), plus actors and level labels. Small at any org " +
      "size; the right default read.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ summary: unknown }>(
        ctx,
        `${ATLAS_BASE}/summary`,
      );
      return body.summary;
    },
  });

  rl.registerAction("graph.get", {
    access: "read",
    description:
      "The entire operational graph including every task body, " +
      "assignment, binding, and evidence. Payload grows with task " +
      "count — prefer summary plus stage.get.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ graph: unknown }>(
        ctx,
        `${ATLAS_BASE}/graph`,
      );
      return body.graph;
    },
  });

  rl.registerAction("stage.get", {
    access: "read",
    description:
      "One stage in full: its ordered tasks with participants, owner, " +
      "bindings, evidence, and derived automation status.",
    inputSchema: t.Object({ id: idSchema("Stage ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ stage: unknown }>(
        ctx,
        `${ATLAS_BASE}/stages/${pathSegment(id)}`,
      );
      return body.stage;
    },
  });

  rl.registerAction("actor.list", {
    access: "read",
    description: "List the named workers of the graph: agents and human roles.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ actors: unknown[] }>(
        ctx,
        `${ATLAS_BASE}/actors`,
      );
      return body.actors;
    },
  });

  rl.registerAction("line.list", {
    access: "read",
    description:
      "List business lines. Every organization has one default line; " +
      "journeys created without a lineId land there.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ lines: unknown[] }>(
        ctx,
        `${ATLAS_BASE}/lines`,
      );
      return body.lines;
    },
  });

  rl.registerAction("journey.list", {
    access: "read",
    description: "List journeys (id, name, outcome, status, line).",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ journeys: unknown[] }>(
        ctx,
        `${ATLAS_BASE}/journeys`,
      );
      return body.journeys;
    },
  });

  rl.registerAction("journey.get", {
    access: "read",
    description:
      "One journey in full: its stages, their tasks, triggers, and rollups.",
    inputSchema: t.Object({ id: idSchema("Journey ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ journey: unknown }>(
        ctx,
        `${ATLAS_BASE}/journeys/${pathSegment(id)}`,
      );
      return body.journey;
    },
  });

  rl.registerAction("labels.get", {
    access: "read",
    description:
      "What this organization calls each level (line/journey/stage/task).",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      const body = await request<{ labels: unknown }>(
        ctx,
        `${ATLAS_BASE}/labels`,
      );
      return body.labels;
    },
  });

  rl.registerAction("change.list", {
    access: "read",
    description:
      "Append-only change log of the graph, newest first, cursor-" +
      "paginated. Returns { changes, nextCursor? }.",
    inputSchema: t.Object(
      {
        entityType: t.Optional(
          enumSchema("Entity type", GRAPH_CHANGE_ENTITY_TYPE),
        ),
        entityId: t.Optional(idSchema("Entity ID")),
        cursor: t.Optional(cursorSchema()),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(
        input as Record<string, unknown>,
      )) {
        if (value !== undefined) params.set(key, String(value));
      }
      return request(ctx, `${ATLAS_BASE}/changes?${params}`);
    },
  });

  /* -------------------------------------------------------------- */
  /* Mutations — each mirrors one service input schema.             */
  /* -------------------------------------------------------------- */

  function create(
    action: string,
    entity: string,
    path: (input: Record<string, unknown>) => string,
    description: string,
    fields: Fields,
    bodyKeys?: string[],
  ) {
    rl.registerAction(action, {
      access: "write",
      description,
      inputSchema: t.Object(fields, STRICT_OBJECT),
      async execute(input, ctx) {
        const all = input as Record<string, unknown>;
        const body = bodyKeys
          ? Object.fromEntries(bodyKeys.map((key) => [key, all[key]]))
          : all;
        const response = await request<Record<string, unknown>>(
          ctx,
          path(all),
          { method: "POST", body: JSON.stringify(body) },
        );
        return response[entity];
      },
    });
  }

  function update(
    action: string,
    entity: string,
    collection: string,
    description: string,
    fields: Fields,
  ) {
    rl.registerAction(action, {
      access: "write",
      description,
      inputSchema: t.Object(
        { id: idSchema(`${entity} ID`), ...fields },
        STRICT_UPDATE_OBJECT,
      ),
      async execute(input, ctx) {
        const { id, ...patch } = input as { id: string } & Record<
          string,
          unknown
        >;
        const response = await request<Record<string, unknown>>(
          ctx,
          `${ATLAS_BASE}/${collection}/${pathSegment(id)}`,
          { method: "PATCH", body: JSON.stringify(patch) },
        );
        return response[entity];
      },
    });
  }

  function remove(
    action: string,
    entity: string,
    collection: string,
    description: string,
  ) {
    rl.registerAction(action, {
      access: "write",
      description,
      inputSchema: t.Object({ id: idSchema(`${entity} ID`) }, STRICT_OBJECT),
      async execute(input, ctx) {
        const { id } = input as { id: string };
        await request<undefined>(
          ctx,
          `${ATLAS_BASE}/${collection}/${pathSegment(id)}`,
          { method: "DELETE" },
        );
        return { deleted: true, id };
      },
    });
  }

  /* Actors */
  create(
    "actor.create",
    "actor",
    () => `${ATLAS_BASE}/actors`,
    "Create a named worker: an agent (e.g. Jarvis) or a human role (e.g. CFO).",
    {
      name: name("Actor name"),
      kind: enumSchema("Actor kind", GRAPH_ACTOR_KIND),
      description: t.Optional(longText("What this actor does")),
    },
  );
  update("actor.update", "actor", "actors", "Update an actor.", {
    name: t.Optional(name("Actor name")),
    kind: t.Optional(enumSchema("Actor kind", GRAPH_ACTOR_KIND)),
    description: t.Optional(longText("What this actor does")),
  });
  remove(
    "actor.delete",
    "actor",
    "actors",
    "Delete an actor. Refused (409 actor_in_use) while assignments reference it.",
  );

  /* Lines */
  create(
    "line.create",
    "line",
    () => `${ATLAS_BASE}/lines`,
    "Create a business line — the widest grouping of journeys.",
    {
      name: name("Line name"),
      blurb: t.Optional(longText("One-sentence description")),
      position: t.Optional(position),
    },
  );
  update("line.update", "line", "lines", "Update a business line.", {
    name: t.Optional(name("Line name")),
    blurb: t.Optional(longText("One-sentence description")),
    position: t.Optional(position),
  });
  remove(
    "line.delete",
    "line",
    "lines",
    "Delete a business line. Refused while journeys reference it (line_in_use) or it is the last line (last_line).",
  );

  /* Journeys */
  create(
    "journey.create",
    "journey",
    () => `${ATLAS_BASE}/journeys`,
    "Create a journey: an end-to-end flow with a business outcome. " +
      "Omitting lineId places it in the organization's default line.",
    {
      lineId: t.Optional(idSchema("Business line ID")),
      name: name("Journey name"),
      outcome: t.Optional(longText("The business outcome it delivers")),
      position: t.Optional(position),
      status: t.Optional(enumSchema("Journey status", GRAPH_JOURNEY_STATUS)),
    },
  );
  update("journey.update", "journey", "journeys", "Update a journey.", {
    lineId: t.Optional(idSchema("Business line ID")),
    name: t.Optional(name("Journey name")),
    outcome: t.Optional(longText("The business outcome it delivers")),
    position: t.Optional(position),
    status: t.Optional(enumSchema("Journey status", GRAPH_JOURNEY_STATUS)),
  });
  remove(
    "journey.delete",
    "journey",
    "journeys",
    "Delete a journey and, in cascade, its stages and tasks.",
  );

  /* Stages */
  create(
    "stage.create",
    "stage",
    (input) =>
      `${ATLAS_BASE}/journeys/${pathSegment(input.journeyId as string)}/stages`,
    "Create an ordered stage inside a journey.",
    {
      journeyId: idSchema("Journey ID"),
      name: name("Stage name"),
      intent: t.Optional(longText("What this stage exists to ensure")),
      position: t.Optional(position),
    },
    ["name", "intent", "position"],
  );
  update("stage.update", "stage", "stages", "Update a stage.", {
    name: t.Optional(name("Stage name")),
    intent: t.Optional(longText("What this stage exists to ensure")),
    position: t.Optional(position),
  });
  remove(
    "stage.delete",
    "stage",
    "stages",
    "Delete a stage and, in cascade, its tasks.",
  );

  /* Tasks */
  create(
    "task.create",
    "task",
    (input) =>
      `${ATLAS_BASE}/stages/${pathSegment(input.stageId as string)}/tasks`,
    "Create a task — the atomic responsibility inside a stage. " +
      "actorId also creates the matching `does` assignment (the owner).",
    {
      stageId: idSchema("Stage ID"),
      description: t.String({
        minLength: 1,
        maxLength: 2_000,
        pattern: "\\S",
        description: "What the work is, in the business's own words",
      }),
      position: t.Optional(position),
      intendedMode: enumSchema("Intended mode", GRAPH_TASK_MODE),
      actorId: t.Optional(idSchema("Owner actor ID")),
    },
    ["description", "position", "intendedMode", "actorId"],
  );
  update(
    "task.update",
    "task",
    "tasks",
    "Update a task. actorId replaces the `does` assignment; null clears the owner.",
    {
      description: t.Optional(
        t.String({ minLength: 1, maxLength: 2_000, pattern: "\\S" }),
      ),
      position: t.Optional(position),
      intendedMode: t.Optional(enumSchema("Intended mode", GRAPH_TASK_MODE)),
      actorId: t.Optional(t.Union([idSchema("Owner actor ID"), t.Null()])),
    },
  );
  remove("task.delete", "task", "tasks", "Delete a task.");

  /* Assignments */
  create(
    "assignment.create",
    "assignment",
    (input) =>
      `${ATLAS_BASE}/tasks/${pathSegment(input.taskId as string)}/assignments`,
    "Add an actor to a task in a RACI role. `does` is the owner; a task has at most one.",
    {
      taskId: idSchema("Task ID"),
      actorId: idSchema("Actor ID"),
      role: t.Optional(enumSchema("Assignment role", GRAPH_ASSIGNMENT_ROLE)),
    },
    ["actorId", "role"],
  );
  remove(
    "assignment.delete",
    "assignment",
    "assignments",
    "Remove an actor's part in a task.",
  );

  /* Relations */
  create(
    "relation.create",
    "relation",
    () => `${ATLAS_BASE}/relations`,
    "Create a level-typed link: `follows` joins two tasks in one stage " +
      "(cycles rejected); `triggers` joins two journeys (cycles allowed).",
    {
      kind: enumSchema("Relation kind", GRAPH_RELATION_KIND),
      fromId: idSchema("Source task or journey ID"),
      toId: idSchema("Target task or journey ID"),
    },
  );
  remove("relation.delete", "relation", "relations", "Delete a relation.");

  /* Bindings */
  create(
    "binding.create",
    "binding",
    (input) =>
      `${ATLAS_BASE}/tasks/${pathSegment(input.taskId as string)}/bindings`,
    "Bind a task to how it is executed: a Vex deployment, an external " +
      "system, or manual work. A live non-manual binding is what makes " +
      "a task count as live AI.",
    {
      taskId: idSchema("Task ID"),
      executor: enumSchema("Executor", GRAPH_BINDING_EXECUTOR),
      label: name("Human-readable binding label"),
      status: t.Optional(enumSchema("Binding status", GRAPH_BINDING_STATUS)),
      deploymentId: t.Optional(idSchema("Vex deployment ID")),
      reference: t.Optional(referenceField),
      url: t.Optional(urlField),
    },
    ["executor", "label", "status", "deploymentId", "reference", "url"],
  );
  update(
    "binding.update",
    "binding",
    "bindings",
    "Update a binding; null clears deploymentId, reference, or url.",
    {
      executor: t.Optional(enumSchema("Executor", GRAPH_BINDING_EXECUTOR)),
      label: t.Optional(name("Human-readable binding label")),
      status: t.Optional(enumSchema("Binding status", GRAPH_BINDING_STATUS)),
      deploymentId: t.Optional(
        t.Union([idSchema("Vex deployment ID"), t.Null()]),
      ),
      reference: t.Optional(t.Union([referenceField, t.Null()])),
      url: t.Optional(t.Union([urlField, t.Null()])),
    },
  );
  remove("binding.delete", "binding", "bindings", "Delete a binding.");

  /* Evidence */
  create(
    "evidence.create",
    "evidence",
    (input) =>
      `${ATLAS_BASE}/tasks/${pathSegment(input.taskId as string)}/evidence`,
    "Attach proof the work happens: a report, artifact, or dashboard. " +
      "Requires url or artifactRef.",
    {
      taskId: idSchema("Task ID"),
      title: name("Evidence title"),
      kind: enumSchema("Evidence kind", GRAPH_EVIDENCE_KIND),
      url: t.Optional(urlField),
      artifactRef: t.Optional(referenceField),
    },
    ["title", "kind", "url", "artifactRef"],
  );
  update(
    "evidence.update",
    "evidence",
    "evidence",
    "Update evidence; null clears url or artifactRef.",
    {
      title: t.Optional(name("Evidence title")),
      kind: t.Optional(enumSchema("Evidence kind", GRAPH_EVIDENCE_KIND)),
      url: t.Optional(t.Union([urlField, t.Null()])),
      artifactRef: t.Optional(t.Union([referenceField, t.Null()])),
    },
  );
  remove(
    "evidence.delete",
    "evidence",
    "evidence",
    "Delete an evidence entry.",
  );

  /* Labels */
  rl.registerAction("labels.update", {
    access: "write",
    description:
      "Rename what this organization calls each level — display only, " +
      "no structural consequence.",
    inputSchema: t.Object(
      {
        line: t.Optional(name("Label for the line level")),
        journey: t.Optional(name("Label for the journey level")),
        stage: t.Optional(name("Label for the stage level")),
        task: t.Optional(name("Label for the task level")),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
    async execute(input, ctx) {
      const body = await request<{ labels: unknown }>(
        ctx,
        `${ATLAS_BASE}/labels`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
      return body.labels;
    },
  });
}
