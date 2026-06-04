import type { RunlinePluginAPI } from "runline";
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
    inputSchema: {
      name: { type: "string", required: true, description: "The name of the team" },
      key: { type: "string", required: false, description: "The key of the team. If not given, the key will be generated based on the name" },
      description: { type: "string", required: false, description: "The description of the team" },
      icon: { type: "string", required: false, description: "The icon of the team" },
      color: { type: "string", required: false, description: "The color of the team (hex)" },
      private: { type: "boolean", required: false, description: "Whether the team is private" },
      timezone: { type: "string", required: false, description: "The timezone of the team" },
      cyclesEnabled: { type: "boolean", required: false, description: "Whether the team uses cycles" },
      cycleDuration: { type: "number", required: false, description: "The duration of each cycle in weeks (Int)" },
      cycleCooldownTime: { type: "number", required: false, description: "The cooldown time after each cycle in weeks (Int)" },
      cycleStartDay: { type: "number", required: false, description: "The day of the week that a new cycle starts. 0=Sun..6=Sat (Float)" },
      upcomingCycleCount: { type: "number", required: false, description: "How many upcoming cycles to create (Float)" },
      issueEstimationType: { type: "string", required: false, description: "The issue estimation type: notUsed | exponential | fibonacci | linear | tShirt" },
      triageEnabled: { type: "boolean", required: false, description: "Whether triage mode is enabled for the team" },
      parentId: { type: "string", required: false, description: "The parent team ID (for sub-teams)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
      copySettingsFromTeamId: { type: "string", required: false, description: "The team id to copy settings from, if any" },
    },
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
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the team to update" },
      name: { type: "string", required: false, description: "The name of the team" },
      key: { type: "string", required: false, description: "The key of the team" },
      description: { type: "string", required: false, description: "The description of the team" },
      icon: { type: "string", required: false, description: "The icon of the team" },
      color: { type: "string", required: false, description: "The color of the team (hex)" },
      private: { type: "boolean", required: false, description: "Whether the team is private" },
      timezone: { type: "string", required: false, description: "The timezone of the team" },
      cyclesEnabled: { type: "boolean", required: false, description: "Whether the team uses cycles" },
      cycleDuration: { type: "number", required: false, description: "The duration of each cycle in weeks (Int)" },
      cycleCooldownTime: { type: "number", required: false, description: "The cooldown time after each cycle in weeks (Int)" },
      cycleStartDay: { type: "number", required: false, description: "The day of the week that a new cycle starts. 0=Sun..6=Sat (Float)" },
      upcomingCycleCount: { type: "number", required: false, description: "How many upcoming cycles to create (Float)" },
      issueEstimationType: { type: "string", required: false, description: "The issue estimation type: notUsed | exponential | fibonacci | linear | tShirt" },
      triageEnabled: { type: "boolean", required: false, description: "Whether triage mode is enabled for the team" },
    },
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
    inputSchema: {
      teamId: { type: "string", required: true, description: "The identifier of the team" },
      limit: { type: "number", required: false, description: "Max members to return (default 50)" },
    },
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
