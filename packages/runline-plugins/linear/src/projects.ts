import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  bindGetAction,
  bindListAction,
  gql,
  key,
  MILESTONE_FIELDS,
  PROJECT_FIELDS,
  PROJECT_UPDATE_FIELDS,
  requireUnscoped,
} from "./shared.js";

export function registerProjectActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction(
    "project.list",
    "List projects.",
    "projects",
    "ProjectFilter",
    PROJECT_FIELDS,
  );
  getAction(
    "project.get",
    "Get a project by ID or slug.",
    "project",
    PROJECT_FIELDS,
  );
  rl.registerAction("project.create", {
    description: "Create a project. teamIds is required.",
    inputSchema: t.Object({
      name: t.String({ description: "The name of the project" }),
      teamIds: t.Array(t.Unknown(), {
        description:
          "The identifiers of the teams this project is associated with",
      }),
      description: t.Optional(
        t.String({ description: "The description for the project" }),
      ),
      content: t.Optional(
        t.String({ description: "The project content as markdown" }),
      ),
      icon: t.Optional(t.String({ description: "The icon of the project" })),
      color: t.Optional(
        t.String({ description: "The color of the project (hex)" }),
      ),
      priority: t.Optional(
        t.Number({
          description:
            "The priority of the project. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low",
        }),
      ),
      leadId: t.Optional(
        t.String({ description: "The identifier of the project lead" }),
      ),
      memberIds: t.Optional(
        t.Array(t.Unknown(), {
          description: "The identifiers of the members of this project",
        }),
      ),
      startDate: t.Optional(
        t.String({
          description:
            "The planned start date of the project (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      startDateResolution: t.Optional(
        t.String({
          description:
            "The resolution of the project's start date (DateResolutionType)",
        }),
      ),
      targetDate: t.Optional(
        t.String({
          description:
            "The planned target date of the project (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      targetDateResolution: t.Optional(
        t.String({
          description:
            "The resolution of the project's estimated completion date (DateResolutionType)",
        }),
      ),
      statusId: t.Optional(
        t.String({ description: "The ID of the project status" }),
      ),
      labelIds: t.Optional(
        t.Array(t.Unknown(), {
          description:
            "The identifiers of the project labels associated with this project",
        }),
      ),
      sortOrder: t.Optional(
        t.Number({
          description: "The sort order for the project in shared views (Float)",
        }),
      ),
      templateId: t.Optional(
        t.String({
          description:
            "The ID of a project template to apply when creating the project",
        }),
      ),
      useDefaultTemplate: t.Optional(
        t.Boolean({
          description:
            "Apply the default project template of the first team provided. Ignored if templateId is set",
        }),
      ),
      convertedFromIssueId: t.Optional(
        t.String({
          description:
            "The ID of the issue that was converted into this project",
        }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
      slackChannelName: t.Optional(
        t.String({
          description:
            "The full name for the Slack channel to create (including prefix). Creates and connects a Slack channel if provided",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
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
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project to update (UUID or slug)",
      }),
      name: t.Optional(t.String({ description: "The name of the project" })),
      description: t.Optional(
        t.String({ description: "The description for the project" }),
      ),
      content: t.Optional(
        t.String({ description: "The project content as markdown" }),
      ),
      icon: t.Optional(t.String({ description: "The icon of the project" })),
      color: t.Optional(
        t.String({ description: "The color of the project (hex)" }),
      ),
      priority: t.Optional(
        t.Number({
          description:
            "The priority of the project. 0=No, 1=Urgent, 2=High, 3=Medium, 4=Low",
        }),
      ),
      leadId: t.Optional(
        t.String({ description: "The identifier of the project lead" }),
      ),
      memberIds: t.Optional(
        t.Array(t.Unknown(), {
          description: "The identifiers of the members of this project",
        }),
      ),
      startDate: t.Optional(
        t.String({
          description: "The planned start date (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      startDateResolution: t.Optional(
        t.String({
          description:
            "The resolution of the project's start date (DateResolutionType)",
        }),
      ),
      targetDate: t.Optional(
        t.String({
          description: "The planned target date (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      targetDateResolution: t.Optional(
        t.String({
          description:
            "The resolution of the project's estimated completion date (DateResolutionType)",
        }),
      ),
      statusId: t.Optional(
        t.String({ description: "The ID of the project status" }),
      ),
      labelIds: t.Optional(
        t.Array(t.Unknown(), {
          description:
            "The identifiers of the project labels associated with this project",
        }),
      ),
      teamIds: t.Optional(
        t.Array(t.Unknown(), {
          description:
            "The identifiers of the teams this project is associated with",
        }),
      ),
      sortOrder: t.Optional(
        t.Number({
          description: "The sort order for the project in shared views (Float)",
        }),
      ),
      completedAt: t.Optional(
        t.String({
          description: "The time at which the project was completed (DateTime)",
        }),
      ),
      canceledAt: t.Optional(
        t.String({
          description: "The time at which the project was canceled (DateTime)",
        }),
      ),
      trashed: t.Optional(
        t.Boolean({
          description:
            "Whether the project has been trashed. Set to true to trash, or null to restore",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
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
    description:
      "Trash (soft-delete) a project. Restorable via project.unarchive.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the project to delete" }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
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
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project to restore (UUID or slug)",
      }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
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
    inputSchema: t.Object({
      term: t.String({ description: "Search string to look for" }),
      limit: t.Optional(
        t.Number({
          description: "Max results (forward pagination, default 50)",
        }),
      ),
      includeComments: t.Optional(
        t.Boolean({
          description: "Should associated comments be searched (default false)",
        }),
      ),
      teamId: t.Optional(
        t.String({ description: "UUID of a team to boost in search results" }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
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

  listAction(
    "milestone.list",
    "List project milestones.",
    "projectMilestones",
    "ProjectMilestoneFilter",
    MILESTONE_FIELDS,
  );
  getAction(
    "milestone.get",
    "Get a project milestone by ID.",
    "projectMilestone",
    MILESTONE_FIELDS,
  );
  rl.registerAction("milestone.create", {
    description: "Create a project milestone.",
    inputSchema: t.Object({
      projectId: t.String({
        description: "Related project for the project milestone",
      }),
      name: t.String({ description: "The name of the project milestone" }),
      description: t.Optional(
        t.String({
          description:
            "The description of the project milestone in markdown format",
        }),
      ),
      targetDate: t.Optional(
        t.String({
          description:
            "The planned target date of the project milestone (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      sortOrder: t.Optional(
        t.Number({
          description:
            "The sort order for the project milestone within a project (Float)",
        }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const data = await gql(
        key(ctx),
        `mutation($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success projectMilestone { ${MILESTONE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.projectMilestoneCreate as Record<string, unknown>)
        ?.projectMilestone;
    },
  });
  rl.registerAction("milestone.update", {
    description: "Update a project milestone.",
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project milestone to update",
      }),
      name: t.Optional(
        t.String({ description: "The name of the project milestone" }),
      ),
      description: t.Optional(
        t.String({
          description:
            "The description of the project milestone in markdown format",
        }),
      ),
      targetDate: t.Optional(
        t.String({
          description: "The planned target date (TimelessDate, YYYY-MM-DD)",
        }),
      ),
      projectId: t.Optional(
        t.String({
          description:
            "Related project for the project milestone (move to another project)",
        }),
      ),
      sortOrder: t.Optional(
        t.Number({
          description:
            "The sort order for the project milestone within a project (Float)",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: ProjectMilestoneUpdateInput!) { projectMilestoneUpdate(id: $id, input: $input) { success projectMilestone { ${MILESTONE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.projectMilestoneUpdate as Record<string, unknown>)
        ?.projectMilestone;
    },
  });
  rl.registerAction("milestone.delete", {
    description: "Delete a project milestone.",
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project milestone to delete",
      }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectMilestoneDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectMilestoneDelete;
    },
  });

  // Project updates

  listAction(
    "projectUpdate.list",
    "List project updates.",
    "projectUpdates",
    "ProjectUpdateFilter",
    PROJECT_UPDATE_FIELDS,
  );
  rl.registerAction("projectUpdate.create", {
    description: "Post a status update on a project.",
    inputSchema: t.Object({
      projectId: t.String({
        description: "The project to associate the project update with",
      }),
      body: t.Optional(
        t.String({
          description: "The content of the project update in markdown format",
        }),
      ),
      health: t.Optional(
        t.String({
          description:
            "The health of the project at the time of the update (ProjectUpdateHealthType: onTrack | atRisk | offTrack)",
        }),
      ),
      isDiffHidden: t.Optional(
        t.Boolean({
          description:
            "Whether the diff between the current update and the previous one should be hidden",
        }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const data = await gql(
        key(ctx),
        `mutation($input: ProjectUpdateCreateInput!) { projectUpdateCreate(input: $input) { success projectUpdate { ${PROJECT_UPDATE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.projectUpdateCreate as Record<string, unknown>)
        ?.projectUpdate;
    },
  });
  rl.registerAction("projectUpdate.update", {
    description: "Update a project status update.",
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project update to update",
      }),
      body: t.Optional(
        t.String({
          description: "The content of the project update in markdown format",
        }),
      ),
      health: t.Optional(
        t.String({
          description:
            "The health of the project at the time of the update (ProjectUpdateHealthType: onTrack | atRisk | offTrack)",
        }),
      ),
      isDiffHidden: t.Optional(
        t.Boolean({
          description:
            "Whether the diff between the current update and the previous one should be hidden",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: ProjectUpdateUpdateInput!) { projectUpdateUpdate(id: $id, input: $input) { success projectUpdate { ${PROJECT_UPDATE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.projectUpdateUpdate as Record<string, unknown>)
        ?.projectUpdate;
    },
  });
  rl.registerAction("projectUpdate.archive", {
    description: "Archive a project status update.",
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the project update to archive",
      }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "projects.*");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { projectUpdateArchive(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.projectUpdateArchive;
    },
  });
}
