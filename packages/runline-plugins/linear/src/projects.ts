import type { RunlinePluginAPI } from "runline";
import {
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  PROJECT_UPDATE_FIELDS,
  bindGetAction,
  bindListAction,
  gql,
  key,
} from "./shared.js";

export function registerProjectActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("project.list", "List projects.", "projects", "ProjectFilter", PROJECT_FIELDS);
  getAction("project.get", "Get a project by ID or slug.", "project", PROJECT_FIELDS);
  rl.registerAction("project.create", {
    description: "Create a project. teamIds is required.",
    inputSchema: {
      name: { type: "string", required: true, description: "The name of the project" },
      teamIds: { type: "array", required: true, description: "The identifiers of the teams this project is associated with" },
      description: { type: "string", required: false, description: "The description for the project" },
      content: { type: "string", required: false, description: "The project content as markdown" },
      icon: { type: "string", required: false, description: "The icon of the project" },
      color: { type: "string", required: false, description: "The color of the project (hex)" },
      priority: { type: "number", required: false, description: "The priority of the project. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low" },
      leadId: { type: "string", required: false, description: "The identifier of the project lead" },
      memberIds: { type: "array", required: false, description: "The identifiers of the members of this project" },
      startDate: { type: "string", required: false, description: "The planned start date of the project (TimelessDate, YYYY-MM-DD)" },
      startDateResolution: { type: "string", required: false, description: "The resolution of the project's start date (DateResolutionType)" },
      targetDate: { type: "string", required: false, description: "The planned target date of the project (TimelessDate, YYYY-MM-DD)" },
      targetDateResolution: { type: "string", required: false, description: "The resolution of the project's estimated completion date (DateResolutionType)" },
      statusId: { type: "string", required: false, description: "The ID of the project status" },
      labelIds: { type: "array", required: false, description: "The identifiers of the project labels associated with this project" },
      sortOrder: { type: "number", required: false, description: "The sort order for the project in shared views (Float)" },
      templateId: { type: "string", required: false, description: "The ID of a project template to apply when creating the project" },
      useDefaultTemplate: { type: "boolean", required: false, description: "Apply the default project template of the first team provided. Ignored if templateId is set" },
      convertedFromIssueId: { type: "string", required: false, description: "The ID of the issue that was converted into this project" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
      slackChannelName: { type: "string", required: false, description: "The full name for the Slack channel to create (including prefix). Creates and connects a Slack channel if provided" },
    },
    async execute(input, ctx) {
      const { slackChannelName, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($input: ProjectCreateInput!, $slackChannelName: String) { projectCreate(input: $input, slackChannelName: $slackChannelName) { success project { ${PROJECT_FIELDS} } } }`,
        { input: fields, slackChannelName: slackChannelName ?? null },
      );
      return (data.projectCreate as Record<string, unknown>)?.project;
    },
  });
  rl.registerAction("project.update", {
    description: "Update a project.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the project to update (UUID or slug)" },
      name: { type: "string", required: false, description: "The name of the project" },
      description: { type: "string", required: false, description: "The description for the project" },
      content: { type: "string", required: false, description: "The project content as markdown" },
      icon: { type: "string", required: false, description: "The icon of the project" },
      color: { type: "string", required: false, description: "The color of the project (hex)" },
      priority: { type: "number", required: false, description: "The priority of the project. 0=No, 1=Urgent, 2=High, 3=Medium, 4=Low" },
      leadId: { type: "string", required: false, description: "The identifier of the project lead" },
      memberIds: { type: "array", required: false, description: "The identifiers of the members of this project" },
      startDate: { type: "string", required: false, description: "The planned start date (TimelessDate, YYYY-MM-DD)" },
      startDateResolution: { type: "string", required: false, description: "The resolution of the project's start date (DateResolutionType)" },
      targetDate: { type: "string", required: false, description: "The planned target date (TimelessDate, YYYY-MM-DD)" },
      targetDateResolution: { type: "string", required: false, description: "The resolution of the project's estimated completion date (DateResolutionType)" },
      statusId: { type: "string", required: false, description: "The ID of the project status" },
      labelIds: { type: "array", required: false, description: "The identifiers of the project labels associated with this project" },
      teamIds: { type: "array", required: false, description: "The identifiers of the teams this project is associated with" },
      sortOrder: { type: "number", required: false, description: "The sort order for the project in shared views (Float)" },
      completedAt: { type: "string", required: false, description: "The time at which the project was completed (DateTime)" },
      canceledAt: { type: "string", required: false, description: "The time at which the project was canceled (DateTime)" },
      trashed: { type: "boolean", required: false, description: "Whether the project has been trashed. Set to true to trash, or null to restore" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { success project { ${PROJECT_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.projectUpdate as Record<string, unknown>)?.project;
    },
  });
  rl.registerAction("project.delete", {
    description: "Trash (soft-delete) a project. Restorable via project.unarchive.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the project to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectDelete;
    },
  });
  rl.registerAction("project.unarchive", {
    description: "Restore a previously trashed or archived project.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the project to restore (UUID or slug)" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectUnarchive(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectUnarchive;
    },
  });
  rl.registerAction("project.search", {
    description: "Search projects by text. Rate-limited to 30 req/min.",
    inputSchema: {
      term: { type: "string", required: true, description: "Search string to look for" },
      limit: { type: "number", required: false, description: "Max results (forward pagination, default 50)" },
      includeComments: { type: "boolean", required: false, description: "Should associated comments be searched (default false)" },
      teamId: { type: "string", required: false, description: "UUID of a team to boost in search results" },
    },
    async execute(input, ctx) {
      const opts = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `query($term: String!, $first: Int, $includeComments: Boolean, $teamId: String) {
          searchProjects(term: $term, first: $first, includeComments: $includeComments, teamId: $teamId) {
            nodes { ${PROJECT_FIELDS} }
            totalCount
          }
        }`,
        {
          term: opts.term,
          first: opts.limit ?? 50,
          includeComments: opts.includeComments ?? null,
          teamId: opts.teamId ?? null,
        },
      );
      return data.searchProjects;
    },
  });

  // Project milestones

  listAction("milestone.list", "List project milestones.", "projectMilestones", "ProjectMilestoneFilter", MILESTONE_FIELDS);
  getAction("milestone.get", "Get a project milestone by ID.", "projectMilestone", MILESTONE_FIELDS);
  rl.registerAction("milestone.create", {
    description: "Create a project milestone.",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Related project for the project milestone" },
      name: { type: "string", required: true, description: "The name of the project milestone" },
      description: { type: "string", required: false, description: "The description of the project milestone in markdown format" },
      targetDate: { type: "string", required: false, description: "The planned target date of the project milestone (TimelessDate, YYYY-MM-DD)" },
      sortOrder: { type: "number", required: false, description: "The sort order for the project milestone within a project (Float)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success projectMilestone { ${MILESTONE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.projectMilestoneCreate as Record<string, unknown>)?.projectMilestone;
    },
  });
  rl.registerAction("milestone.update", {
    description: "Update a project milestone.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the project milestone to update" },
      name: { type: "string", required: false, description: "The name of the project milestone" },
      description: { type: "string", required: false, description: "The description of the project milestone in markdown format" },
      targetDate: { type: "string", required: false, description: "The planned target date (TimelessDate, YYYY-MM-DD)" },
      projectId: { type: "string", required: false, description: "Related project for the project milestone (move to another project)" },
      sortOrder: { type: "number", required: false, description: "The sort order for the project milestone within a project (Float)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: ProjectMilestoneUpdateInput!) { projectMilestoneUpdate(id: $id, input: $input) { success projectMilestone { ${MILESTONE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.projectMilestoneUpdate as Record<string, unknown>)?.projectMilestone;
    },
  });
  rl.registerAction("milestone.delete", {
    description: "Delete a project milestone.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the project milestone to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectMilestoneDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectMilestoneDelete;
    },
  });

  // Project updates

  listAction("projectUpdate.list", "List project updates.", "projectUpdates", "ProjectUpdateFilter", PROJECT_UPDATE_FIELDS);
  rl.registerAction("projectUpdate.create", {
    description: "Post a status update on a project.",
    inputSchema: {
      projectId: { type: "string", required: true, description: "The project to associate the project update with" },
      body: { type: "string", required: false, description: "The content of the project update in markdown format" },
      health: { type: "string", required: false, description: "The health of the project at the time of the update (ProjectUpdateHealthType: onTrack | atRisk | offTrack)" },
      isDiffHidden: { type: "boolean", required: false, description: "Whether the diff between the current update and the previous one should be hidden" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: ProjectUpdateCreateInput!) { projectUpdateCreate(input: $input) { success projectUpdate { ${PROJECT_UPDATE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.projectUpdateCreate as Record<string, unknown>)?.projectUpdate;
    },
  });
  rl.registerAction("projectUpdate.update", {
    description: "Update a project status update.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the project update to update" },
      body: { type: "string", required: false, description: "The content of the project update in markdown format" },
      health: { type: "string", required: false, description: "The health of the project at the time of the update (ProjectUpdateHealthType: onTrack | atRisk | offTrack)" },
      isDiffHidden: { type: "boolean", required: false, description: "Whether the diff between the current update and the previous one should be hidden" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: ProjectUpdateUpdateInput!) { projectUpdateUpdate(id: $id, input: $input) { success projectUpdate { ${PROJECT_UPDATE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.projectUpdateUpdate as Record<string, unknown>)?.projectUpdate;
    },
  });
  rl.registerAction("projectUpdate.archive", {
    description: "Archive a project status update.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the project update to archive" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectUpdateArchive(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectUpdateArchive;
    },
  });
}
