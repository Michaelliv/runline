import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { LABEL_FIELDS, bindGetAction, bindListAction, gql, key, requireUnscoped } from "./shared.js";

export function registerLabelActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("label.list", "List labels (workspace + team-scoped).", "issueLabels", "IssueLabelFilter", LABEL_FIELDS);
  getAction("label.get", "Get a label by ID.", "issueLabel", LABEL_FIELDS);
  rl.registerAction("label.create", {
    description: "Create a label. Omit teamId for a workspace-level label.",
    inputSchema: t.Object({
      name: t.String({ description: "The name of the label" }),
      teamId: t.Optional(t.String({ description: "The team associated with the label. If omitted, the label is workspace-scoped" })),
      color: t.Optional(t.String({ description: "The color of the label (hex)" })),
      description: t.Optional(t.String({ description: "The description of the label" })),
      parentId: t.Optional(t.String({ description: "The identifier of the parent label (group label)" })),
      isGroup: t.Optional(t.Boolean({ description: "Whether the label is a group" })),
      retiredAt: t.Optional(t.String({ description: "The time at which the label was retired (DateTime). Set to null to restore a retired label" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
      replaceTeamLabels: t.Optional(t.Boolean({ description: "Replace all team-specific labels with the same name with this newly created workspace label (default false)" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "label.create");
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
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the label to update" }),
      name: t.Optional(t.String({ description: "The name of the label" })),
      color: t.Optional(t.String({ description: "The color of the label (hex)" })),
      description: t.Optional(t.String({ description: "The description of the label" })),
      parentId: t.Optional(t.String({ description: "The identifier of the parent label" })),
      isGroup: t.Optional(t.Boolean({ description: "Whether the label is a group" })),
      retiredAt: t.Optional(t.String({ description: "The time at which the label was retired (DateTime). Set to null to restore a retired label" })),
      replaceTeamLabels: t.Optional(t.Boolean({ description: "Replace all team-specific labels with the same name with this updated workspace label (default false)" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "label.update");
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
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the label to delete" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "label.delete");
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
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the label to retire" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "label.retire");
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
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the label to restore" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "label.restore");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { issueLabelRestore(id: $id) { success issueLabel { ${LABEL_FIELDS} } } }`,
        { id: (input as { id: string }).id },
      );
      return (data.issueLabelRestore as Record<string, unknown>)?.issueLabel;
    },
  });
}
