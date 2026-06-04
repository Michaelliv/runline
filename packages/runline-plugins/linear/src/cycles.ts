import type { RunlinePluginAPI } from "runline";
import { CYCLE_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerCycleActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("cycle.list", "List cycles. Use filter for isActive/isNext/isPrevious.", "cycles", "CycleFilter", CYCLE_FIELDS);
  getAction("cycle.get", "Get a cycle by ID.", "cycle", CYCLE_FIELDS);
  rl.registerAction("cycle.create", {
    description: "Create a cycle for a team.",
    inputSchema: {
      teamId: { type: "string", required: true, description: "The team to associate the cycle with" },
      startsAt: { type: "string", required: true, description: "The start time of the cycle (DateTime, ISO 8601)" },
      endsAt: { type: "string", required: true, description: "The end time of the cycle (DateTime, ISO 8601)" },
      name: { type: "string", required: false, description: "The custom name of the cycle" },
      description: { type: "string", required: false, description: "The description of the cycle" },
      completedAt: { type: "string", required: false, description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
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
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the cycle to update" },
      name: { type: "string", required: false, description: "The custom name of the cycle" },
      description: { type: "string", required: false, description: "The description of the cycle" },
      startsAt: { type: "string", required: false, description: "The start time of the cycle (DateTime, ISO 8601)" },
      endsAt: { type: "string", required: false, description: "The end time of the cycle (DateTime, ISO 8601)" },
      completedAt: { type: "string", required: false, description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" },
    },
    async execute(input, ctx) {
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
