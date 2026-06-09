import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { CYCLE_FIELDS, bindGetAction, bindListAction, gql, key, requireUnscoped } from "./shared.js";

export function registerCycleActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("cycle.list", "List cycles. Use filter for isActive/isNext/isPrevious.", "cycles", "CycleFilter", CYCLE_FIELDS);
  getAction("cycle.get", "Get a cycle by ID.", "cycle", CYCLE_FIELDS);
  rl.registerAction("cycle.create", {
    description: "Create a cycle for a team.",
    inputSchema: t.Object({
      teamId: t.String({ description: "The team to associate the cycle with" }),
      startsAt: t.String({ description: "The start time of the cycle (DateTime, ISO 8601)" }),
      endsAt: t.String({ description: "The end time of the cycle (DateTime, ISO 8601)" }),
      name: t.Optional(t.String({ description: "The custom name of the cycle" })),
      description: t.Optional(t.String({ description: "The description of the cycle" })),
      completedAt: t.Optional(t.String({ description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const data = await gql(
        key(ctx),
        `mutation($input: CycleCreateInput!) { cycleCreate(input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.cycleCreate as Record<string, unknown>)?.cycle;
    },
  });
  rl.registerAction("cycle.update", {
    description: "Update a cycle.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the cycle to update" }),
      name: t.Optional(t.String({ description: "The custom name of the cycle" })),
      description: t.Optional(t.String({ description: "The description of the cycle" })),
      startsAt: t.Optional(t.String({ description: "The start time of the cycle (DateTime, ISO 8601)" })),
      endsAt: t.Optional(t.String({ description: "The end time of the cycle (DateTime, ISO 8601)" })),
      completedAt: t.Optional(t.String({ description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "cycles.*");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CycleUpdateInput!) { cycleUpdate(id: $id, input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.cycleUpdate as Record<string, unknown>)?.cycle;
    },
  });
}
