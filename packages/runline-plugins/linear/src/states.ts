import type { RunlinePluginAPI } from "runline";
import { STATE_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerStateActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("state.list", "List workflow states. Filter by team for team-scoped states.", "workflowStates", "WorkflowStateFilter", STATE_FIELDS);
  getAction("state.get", "Get a workflow state by ID.", "workflowState", STATE_FIELDS);
  rl.registerAction("state.create", {
    description: "Create a workflow state in a team.",
    inputSchema: {
      teamId: { type: "string", required: true, description: "The team associated with the state" },
      name: { type: "string", required: true, description: "The name of the state" },
      type: { type: "string", required: true, description: "The workflow state type which categorizes the state. Valid values: backlog, unstarted, started, completed, canceled" },
      color: { type: "string", required: true, description: "The color of the state (hex, e.g. #6B7280)" },
      description: { type: "string", required: false, description: "The description of the state" },
      position: { type: "number", required: false, description: "The position of the state (Float)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.workflowStateCreate as Record<string, unknown>)?.workflowState;
    },
  });
  rl.registerAction("state.update", {
    description: "Update a workflow state. Type cannot be changed after creation.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the state to update" },
      name: { type: "string", required: false, description: "The name of the state" },
      color: { type: "string", required: false, description: "The color of the state (hex)" },
      description: { type: "string", required: false, description: "The description of the state" },
      position: { type: "number", required: false, description: "The position of the state (Float)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: WorkflowStateUpdateInput!) { workflowStateUpdate(id: $id, input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.workflowStateUpdate as Record<string, unknown>)?.workflowState;
    },
  });
}
