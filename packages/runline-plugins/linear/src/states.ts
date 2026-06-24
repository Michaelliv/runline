import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  bindGetAction,
  bindListAction,
  gql,
  key,
  requireUnscoped,
  STATE_FIELDS,
} from "./shared.js";

export function registerStateActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction(
    "state.list",
    "List workflow states. Filter by team for team-scoped states.",
    "workflowStates",
    "WorkflowStateFilter",
    STATE_FIELDS,
  );
  getAction(
    "state.get",
    "Get a workflow state by ID.",
    "workflowState",
    STATE_FIELDS,
  );
  rl.registerAction("state.create", {
    description: "Create a workflow state in a team.",
    inputSchema: t.Object({
      teamId: t.String({ description: "The team associated with the state" }),
      name: t.String({ description: "The name of the state" }),
      type: t.String({
        description:
          "The workflow state type which categorizes the state. Valid values: backlog, unstarted, started, completed, canceled",
      }),
      color: t.String({
        description: "The color of the state (hex, e.g. #6B7280)",
      }),
      description: t.Optional(
        t.String({ description: "The description of the state" }),
      ),
      position: t.Optional(
        t.Number({ description: "The position of the state (Float)" }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "state.create");
      const data = await gql(
        key(ctx),
        `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.workflowStateCreate as Record<string, unknown>)
        ?.workflowState;
    },
  });
  rl.registerAction("state.update", {
    description:
      "Update a workflow state. Type cannot be changed after creation.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the state to update" }),
      name: t.Optional(t.String({ description: "The name of the state" })),
      color: t.Optional(
        t.String({ description: "The color of the state (hex)" }),
      ),
      description: t.Optional(
        t.String({ description: "The description of the state" }),
      ),
      position: t.Optional(
        t.Number({ description: "The position of the state (Float)" }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "state.update");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: WorkflowStateUpdateInput!) { workflowStateUpdate(id: $id, input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.workflowStateUpdate as Record<string, unknown>)
        ?.workflowState;
    },
  });
}
