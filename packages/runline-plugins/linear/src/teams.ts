import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  TEAM_FIELDS,
  USER_FIELDS,
  bindGetAction,
  bindListAction,
  gql,
  key,
} from "./shared.js";

export function registerTeamActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("team.list", "List teams whose issues you can access.", "teams", "TeamFilter", TEAM_FIELDS);
  getAction("team.get", "Get a team by ID or key.", "team", TEAM_FIELDS);
  rl.registerAction("team.create", {
    description: "Create a team. Most settings have sensible defaults.",
    inputSchema: t.Object({
      name: t.String({ description: "The name of the team" }),
      key: t.Optional(t.String({ description: "The key of the team. If not given, the key will be generated based on the name" })),
      description: t.Optional(t.String({ description: "The description of the team" })),
      icon: t.Optional(t.String({ description: "The icon of the team" })),
      color: t.Optional(t.String({ description: "The color of the team (hex)" })),
      private: t.Optional(t.Boolean({ description: "Whether the team is private" })),
      timezone: t.Optional(t.String({ description: "The timezone of the team" })),
      cyclesEnabled: t.Optional(t.Boolean({ description: "Whether the team uses cycles" })),
      cycleDuration: t.Optional(t.Number({ description: "The duration of each cycle in weeks (Int)" })),
      cycleCooldownTime: t.Optional(t.Number({ description: "The cooldown time after each cycle in weeks (Int)" })),
      cycleStartDay: t.Optional(t.Number({ description: "The day of the week that a new cycle starts. 0=Sun..6=Sat (Float)" })),
      upcomingCycleCount: t.Optional(t.Number({ description: "How many upcoming cycles to create (Float)" })),
      issueEstimationType: t.Optional(t.String({ description: "The issue estimation type: notUsed | exponential | fibonacci | linear | tShirt" })),
      triageEnabled: t.Optional(t.Boolean({ description: "Whether triage mode is enabled for the team" })),
      parentId: t.Optional(t.String({ description: "The parent team ID (for sub-teams)" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
      copySettingsFromTeamId: t.Optional(t.String({ description: "The team id to copy settings from, if any" })),
    }),
    async execute(input, ctx) {
      const { copySettingsFromTeamId, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($input: TeamCreateInput!, $copySettingsFromTeamId: String) { teamCreate(input: $input, copySettingsFromTeamId: $copySettingsFromTeamId) { success team { ${TEAM_FIELDS} } } }`,
        { input: fields, copySettingsFromTeamId: copySettingsFromTeamId ?? null },
      );
      return (data.teamCreate as Record<string, unknown>)?.team;
    },
  });
  rl.registerAction("team.update", {
    description: "Update a team. Requires team owner or workspace admin permissions.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the team to update" }),
      name: t.Optional(t.String({ description: "The name of the team" })),
      key: t.Optional(t.String({ description: "The key of the team" })),
      description: t.Optional(t.String({ description: "The description of the team" })),
      icon: t.Optional(t.String({ description: "The icon of the team" })),
      color: t.Optional(t.String({ description: "The color of the team (hex)" })),
      private: t.Optional(t.Boolean({ description: "Whether the team is private" })),
      timezone: t.Optional(t.String({ description: "The timezone of the team" })),
      cyclesEnabled: t.Optional(t.Boolean({ description: "Whether the team uses cycles" })),
      cycleDuration: t.Optional(t.Number({ description: "The duration of each cycle in weeks (Int)" })),
      cycleCooldownTime: t.Optional(t.Number({ description: "The cooldown time after each cycle in weeks (Int)" })),
      cycleStartDay: t.Optional(t.Number({ description: "The day of the week that a new cycle starts. 0=Sun..6=Sat (Float)" })),
      upcomingCycleCount: t.Optional(t.Number({ description: "How many upcoming cycles to create (Float)" })),
      issueEstimationType: t.Optional(t.String({ description: "The issue estimation type: notUsed | exponential | fibonacci | linear | tShirt" })),
      triageEnabled: t.Optional(t.Boolean({ description: "Whether triage mode is enabled for the team" })),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: TeamUpdateInput!) { teamUpdate(id: $id, input: $input) { success team { ${TEAM_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.teamUpdate as Record<string, unknown>)?.team;
    },
  });
  rl.registerAction("team.members", {
    description: "List members of a team.",
    inputSchema: t.Object({
      teamId: t.String({ description: "The identifier of the team" }),
      limit: t.Optional(t.Number({ description: "Max members to return (default 50)" })),
    }),
    async execute(input, ctx) {
      const { teamId, limit } = input as { teamId: string; limit?: number };
      const data = await gql(
        key(ctx),
        `query($id: String!, $first: Int) {
          team(id: $id) { members(first: $first) { nodes { ${USER_FIELDS} } } }
        }`,
        { id: teamId, first: limit ?? 50 },
      );
      return ((data.team as Record<string, unknown>)?.members as Record<string, unknown>)?.nodes;
    },
  });
}
