import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { INITIATIVE_FIELDS, bindGetAction, bindListAction, gql, key, requireUnscoped } from "./shared.js";

export function registerInitiativeActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("initiative.list", "List initiatives.", "initiatives", "InitiativeFilter", INITIATIVE_FIELDS);
  getAction("initiative.get", "Get an initiative by ID or slug.", "initiative", INITIATIVE_FIELDS);
  rl.registerAction("initiative.create", {
    description: "Create an initiative. Status: Planned | Active | Completed.",
    inputSchema: t.Object({
      name: t.String({ description: "The name of the initiative" }),
      description: t.Optional(t.String({ description: "The description of the initiative" })),
      content: t.Optional(t.String({ description: "The initiative's content in markdown format" })),
      icon: t.Optional(t.String({ description: "The initiative's icon" })),
      color: t.Optional(t.String({ description: "The initiative's color (hex)" })),
      ownerId: t.Optional(t.String({ description: "The owner of the initiative" })),
      status: t.Optional(t.String({ description: "The initiative's status (InitiativeStatus: Planned | Active | Completed)" })),
      targetDate: t.Optional(t.String({ description: "The estimated completion date of the initiative (TimelessDate, YYYY-MM-DD)" })),
      targetDateResolution: t.Optional(t.String({ description: "The resolution of the initiative's estimated completion date (DateResolutionType)" })),
      sortOrder: t.Optional(t.Number({ description: "The sort order of the initiative within the workspace (Float)" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "initiatives.*");
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
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the initiative to update" }),
      name: t.Optional(t.String({ description: "The name of the initiative" })),
      description: t.Optional(t.String({ description: "The description of the initiative" })),
      content: t.Optional(t.String({ description: "The initiative's content in markdown format" })),
      icon: t.Optional(t.String({ description: "The initiative's icon" })),
      color: t.Optional(t.String({ description: "The initiative's color (hex)" })),
      ownerId: t.Optional(t.String({ description: "The owner of the initiative" })),
      status: t.Optional(t.String({ description: "The initiative's status (InitiativeStatus: Planned | Active | Completed)" })),
      targetDate: t.Optional(t.String({ description: "The estimated completion date (TimelessDate, YYYY-MM-DD). Set to null to clear" })),
      targetDateResolution: t.Optional(t.String({ description: "The resolution of the initiative's estimated completion date (DateResolutionType)" })),
      sortOrder: t.Optional(t.Number({ description: "The sort order of the initiative within the workspace (Float)" })),
      trashed: t.Optional(t.Boolean({ description: "Whether the initiative has been trashed. Set to true to trash, or null to restore" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "initiatives.*");
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
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the initiative to delete" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "initiatives.*");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { initiativeDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.initiativeDelete;
    },
  });
  rl.registerAction("initiative.addProject", {
    description: "Associate a project with an initiative. Use this action for project-to-initiative linking; project.update does not accept initiativeId. Verify with initiative.get or the returned initiative.projects list.",
    inputSchema: t.Object({
      initiativeId: t.String({ description: "The identifier of the initiative" }),
      projectId: t.String({ description: "The identifier of the project" }),
      sortOrder: t.Optional(t.Number({ description: "The sort order for the project within the initiative (Float)" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "initiatives.*");
      const data = await gql(
        key(ctx),
        `mutation($input: InitiativeToProjectCreateInput!) { initiativeToProjectCreate(input: $input) { success initiativeToProject { id initiative { id name projects { nodes { id name } } } project { id name } } } }`,
        { input: input as Record<string, unknown> },
      );
      return data.initiativeToProjectCreate;
    },
  });
  rl.registerAction("initiative.removeProject", {
    description: "Remove a project from an initiative. Pass the link id returned by initiative.addProject, then verify with initiative.get.",
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the initiativeToProject to delete" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "initiatives.*");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { initiativeToProjectDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.initiativeToProjectDelete;
    },
  });
}
