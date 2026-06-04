import type { RunlinePluginAPI } from "runline";
import { LABEL_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerLabelActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("label.list", "List labels (workspace + team-scoped).", "issueLabels", "IssueLabelFilter", LABEL_FIELDS);
  getAction("label.get", "Get a label by ID.", "issueLabel", LABEL_FIELDS);
  rl.registerAction("label.create", {
    description: "Create a label. Omit teamId for a workspace-level label.",
    inputSchema: {
      name: { type: "string", required: true, description: "The name of the label" },
      teamId: { type: "string", required: false, description: "The team associated with the label. If omitted, the label is workspace-scoped" },
      color: { type: "string", required: false, description: "The color of the label (hex)" },
      description: { type: "string", required: false, description: "The description of the label" },
      parentId: { type: "string", required: false, description: "The identifier of the parent label (group label)" },
      isGroup: { type: "boolean", required: false, description: "Whether the label is a group" },
      retiredAt: { type: "string", required: false, description: "The time at which the label was retired (DateTime). Set to null to restore a retired label" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
      replaceTeamLabels: { type: "boolean", required: false, description: "Replace all team-specific labels with the same name with this newly created workspace label (default false)" },
    },
    async execute(input, ctx) {
      const { replaceTeamLabels, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($input: IssueLabelCreateInput!, $replaceTeamLabels: Boolean) { issueLabelCreate(input: $input, replaceTeamLabels: $replaceTeamLabels) { success issueLabel { ${LABEL_FIELDS} } } }`,
        { input: fields, replaceTeamLabels: replaceTeamLabels ?? null },
      );
      return (data.issueLabelCreate as Record<string, unknown>)?.issueLabel;
    },
  });
  rl.registerAction("label.update", {
    description: "Update a label.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the label to update" },
      name: { type: "string", required: false, description: "The name of the label" },
      color: { type: "string", required: false, description: "The color of the label (hex)" },
      description: { type: "string", required: false, description: "The description of the label" },
      parentId: { type: "string", required: false, description: "The identifier of the parent label" },
      isGroup: { type: "boolean", required: false, description: "Whether the label is a group" },
      retiredAt: { type: "string", required: false, description: "The time at which the label was retired (DateTime). Set to null to restore a retired label" },
      replaceTeamLabels: { type: "boolean", required: false, description: "Replace all team-specific labels with the same name with this updated workspace label (default false)" },
    },
    async execute(input, ctx) {
      const { id, replaceTeamLabels, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: IssueLabelUpdateInput!, $replaceTeamLabels: Boolean) { issueLabelUpdate(id: $id, input: $input, replaceTeamLabels: $replaceTeamLabels) { success issueLabel { ${LABEL_FIELDS} } } }`,
        { id, input: fields, replaceTeamLabels: replaceTeamLabels ?? null },
      );
      return (data.issueLabelUpdate as Record<string, unknown>)?.issueLabel;
    },
  });
  rl.registerAction("label.delete", {
    description: "Delete a label.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the label to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { issueLabelDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.issueLabelDelete;
    },
  });
  rl.registerAction("label.retire", {
    description: "Retire a label. Retired labels remain visible but cannot be applied to new issues.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the label to retire" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { issueLabelRetire(id: $id) { success issueLabel { ${LABEL_FIELDS} } } }`,
        { id: (input as { id: string }).id },
      );
      return (data.issueLabelRetire as Record<string, unknown>)?.issueLabel;
    },
  });
  rl.registerAction("label.restore", {
    description: "Restore a previously retired label.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the label to restore" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { issueLabelRestore(id: $id) { success issueLabel { ${LABEL_FIELDS} } } }`,
        { id: (input as { id: string }).id },
      );
      return (data.issueLabelRestore as Record<string, unknown>)?.issueLabel;
    },
  });
}
