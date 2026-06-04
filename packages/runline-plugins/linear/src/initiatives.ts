import type { RunlinePluginAPI } from "runline";
import { INITIATIVE_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerInitiativeActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("initiative.list", "List initiatives.", "initiatives", "InitiativeFilter", INITIATIVE_FIELDS);
  getAction("initiative.get", "Get an initiative by ID or slug.", "initiative", INITIATIVE_FIELDS);
  rl.registerAction("initiative.create", {
    description: "Create an initiative. Status: Planned | Active | Completed.",
    inputSchema: {
      name: { type: "string", required: true, description: "The name of the initiative" },
      description: { type: "string", required: false, description: "The description of the initiative" },
      content: { type: "string", required: false, description: "The initiative's content in markdown format" },
      icon: { type: "string", required: false, description: "The initiative's icon" },
      color: { type: "string", required: false, description: "The initiative's color (hex)" },
      ownerId: { type: "string", required: false, description: "The owner of the initiative" },
      status: { type: "string", required: false, description: "The initiative's status (InitiativeStatus: Planned | Active | Completed)" },
      targetDate: { type: "string", required: false, description: "The estimated completion date of the initiative (TimelessDate, YYYY-MM-DD)" },
      targetDateResolution: { type: "string", required: false, description: "The resolution of the initiative's estimated completion date (DateResolutionType)" },
      sortOrder: { type: "number", required: false, description: "The sort order of the initiative within the workspace (Float)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: InitiativeCreateInput!) { initiativeCreate(input: $input) { success initiative { ${INITIATIVE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.initiativeCreate as Record<string, unknown>)?.initiative;
    },
  });
  rl.registerAction("initiative.update", {
    description: "Update an initiative.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the initiative to update" },
      name: { type: "string", required: false, description: "The name of the initiative" },
      description: { type: "string", required: false, description: "The description of the initiative" },
      content: { type: "string", required: false, description: "The initiative's content in markdown format" },
      icon: { type: "string", required: false, description: "The initiative's icon" },
      color: { type: "string", required: false, description: "The initiative's color (hex)" },
      ownerId: { type: "string", required: false, description: "The owner of the initiative" },
      status: { type: "string", required: false, description: "The initiative's status (InitiativeStatus: Planned | Active | Completed)" },
      targetDate: { type: "string", required: false, description: "The estimated completion date (TimelessDate, YYYY-MM-DD). Set to null to clear" },
      targetDateResolution: { type: "string", required: false, description: "The resolution of the initiative's estimated completion date (DateResolutionType)" },
      sortOrder: { type: "number", required: false, description: "The sort order of the initiative within the workspace (Float)" },
      trashed: { type: "boolean", required: false, description: "Whether the initiative has been trashed. Set to true to trash, or null to restore" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: InitiativeUpdateInput!) { initiativeUpdate(id: $id, input: $input) { success initiative { ${INITIATIVE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.initiativeUpdate as Record<string, unknown>)?.initiative;
    },
  });
  rl.registerAction("initiative.delete", {
    description: "Trash an initiative.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the initiative to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { initiativeDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.initiativeDelete;
    },
  });
  rl.registerAction("initiative.addProject", {
    description: "Associate a project with an initiative. A project can only appear once in an initiative hierarchy.",
    inputSchema: {
      initiativeId: { type: "string", required: true, description: "The identifier of the initiative" },
      projectId: { type: "string", required: true, description: "The identifier of the project" },
      sortOrder: { type: "number", required: false, description: "The sort order for the project within the initiative (Float)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: InitiativeToProjectCreateInput!) { initiativeToProjectCreate(input: $input) { success initiativeToProject { id } } }`,
        { input: input as Record<string, unknown> },
      );
      return data.initiativeToProjectCreate;
    },
  });
  rl.registerAction("initiative.removeProject", {
    description: "Remove a project from an initiative. Pass the link id returned by initiative.addProject.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the initiativeToProject to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { initiativeToProjectDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.initiativeToProjectDelete;
    },
  });
}
