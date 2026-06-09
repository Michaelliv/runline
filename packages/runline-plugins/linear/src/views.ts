import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CUSTOM_VIEW_FIELDS,
  FEED_ITEM_FIELDS,
  INITIATIVE_FIELDS,
  ISSUE_LITE,
  LIST_INPUT_SCHEMA,
  PROJECT_FIELDS,
  bindGetAction,
  bindListAction,
  buildConnArgs,
  gql,
  key,
  mergeIssueScopeFilter,
  requireUnscoped,
  type ListOpts,
} from "./shared.js";

export function registerViewActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  function customViewConnectionAction(
    name: string,
    description: string,
    connectionField: "issues" | "projects" | "initiatives" | "updates",
    filterTypeName: string,
    selection: string,
    includeSubTeamsDescription?: string,
  ) {
    rl.registerAction(name, {
      description,
      inputSchema: t.Object({
        viewId: t.String({ description: "The custom view ID or slug" }),
        ...LIST_INPUT_SCHEMA,
        ...(includeSubTeamsDescription
          ? { includeSubTeams: t.Optional(t.Boolean({ description: includeSubTeamsDescription })) }
          : {}),
      }),
      async execute(input, ctx) {
        const opts = (input ?? {}) as ListOpts & { viewId: string; includeSubTeams?: boolean };
        const scopedOpts = connectionField === "issues"
          ? { ...opts, filter: mergeIssueScopeFilter(ctx, opts.filter) }
          : opts;
        if (connectionField !== "issues") requireUnscoped(ctx, name);
        const { argsDecl, argsCall, vars } = buildConnArgs(scopedOpts, filterTypeName);
        const declParts = ["$id: String!", argsDecl.slice(1, -1)];
        const callParts = [argsCall.slice(1, -1)];
        const includeSubTeamsSet = includeSubTeamsDescription !== undefined && opts.includeSubTeams !== undefined;
        if (includeSubTeamsSet) {
          declParts.push("$includeSubTeams: Boolean");
          callParts.push("includeSubTeams: $includeSubTeams");
          vars.includeSubTeams = opts.includeSubTeams;
        }
        const data = await gql(
          key(ctx),
          `query(${declParts.join(", ")}) {
            customView(id: $id) { ${connectionField}(${callParts.join(", ")}) { nodes { ${selection} } pageInfo { hasNextPage endCursor } } }
          }`,
          { id: opts.viewId, ...vars },
        );
        const conn = ((data.customView as Record<string, unknown>)?.[connectionField] ?? {}) as Record<string, unknown>;
        return { nodes: conn.nodes, pageInfo: conn.pageInfo };
      },
    });
  }

  listAction("view.list", "List custom views accessible to the user, including personal and shared workspace views. Linear excludes views scoped to a specific project or initiative from this root query.", "customViews", "CustomViewFilter", CUSTOM_VIEW_FIELDS);
  getAction("view.get", "Get a custom view by ID or slug.", "customView", CUSTOM_VIEW_FIELDS);
  rl.registerAction("view.create", {
    description: "Create a custom view. Set filterData for issue views; projectFilterData, initiativeFilterData, or feedItemFilterData for other view types.",
    inputSchema: t.Object({
      name: t.String({ description: "The name of the custom view" }),
      description: t.Optional(t.String({ description: "The description of the custom view" })),
      icon: t.Optional(t.String({ description: "The icon of the custom view" })),
      color: t.Optional(t.String({ description: "The color of the custom view icon (hex)" })),
      shared: t.Optional(t.Boolean({ description: "Whether the custom view is shared with everyone in the workspace" })),
      filterData: t.Optional(t.Object({}, { description: "IssueFilter for issue views" })),
      projectFilterData: t.Optional(t.Object({}, { description: "ProjectFilter for project views" })),
      initiativeFilterData: t.Optional(t.Object({}, { description: "InitiativeFilter for initiative views" })),
      feedItemFilterData: t.Optional(t.Object({}, { description: "FeedItemFilter for update/feed item views" })),
      teamId: t.Optional(t.String({ description: "The team associated with the custom view" })),
      projectId: t.Optional(t.String({ description: "The project associated with the custom view" })),
      initiativeId: t.Optional(t.String({ description: "The initiative associated with the custom view" })),
      ownerId: t.Optional(t.String({ description: "The owner of the custom view" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "view.create");
      const data = await gql(
        key(ctx),
        `mutation($input: CustomViewCreateInput!) { customViewCreate(input: $input) { success customView { ${CUSTOM_VIEW_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.customViewCreate as Record<string, unknown>)?.customView;
    },
  });
  rl.registerAction("view.update", {
    description: "Update a custom view. All fields optional; only provided fields are updated.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the custom view to update" }),
      name: t.Optional(t.String({ description: "The name of the custom view" })),
      description: t.Optional(t.String({ description: "The description of the custom view" })),
      icon: t.Optional(t.String({ description: "The icon of the custom view" })),
      color: t.Optional(t.String({ description: "The color of the custom view icon (hex)" })),
      shared: t.Optional(t.Boolean({ description: "Whether the custom view is shared with everyone in the workspace" })),
      filterData: t.Optional(t.Object({}, { description: "IssueFilter for issue views" })),
      projectFilterData: t.Optional(t.Object({}, { description: "ProjectFilter for project views" })),
      initiativeFilterData: t.Optional(t.Object({}, { description: "InitiativeFilter for initiative views" })),
      feedItemFilterData: t.Optional(t.Object({}, { description: "FeedItemFilter for update/feed item views" })),
      teamId: t.Optional(t.String({ description: "The team associated with the custom view" })),
      projectId: t.Optional(t.String({ description: "The project associated with the custom view" })),
      initiativeId: t.Optional(t.String({ description: "The initiative associated with the custom view" })),
      ownerId: t.Optional(t.String({ description: "The owner of the custom view" })),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "view.update");
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CustomViewUpdateInput!) { customViewUpdate(id: $id, input: $input) { success customView { ${CUSTOM_VIEW_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.customViewUpdate as Record<string, unknown>)?.customView;
    },
  });
  rl.registerAction("view.delete", {
    description: "Delete a custom view.",
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the custom view to delete" }) }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "view.delete");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { customViewDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.customViewDelete;
    },
  });
  customViewConnectionAction(
    "view.issues",
    "List issues matching a custom view's issue filter. Returns an empty connection when the view's modelName is not Issue.",
    "issues",
    "IssueFilter",
    ISSUE_LITE,
    "Include issues from sub-teams when the custom view is associated with a team",
  );
  customViewConnectionAction(
    "view.projects",
    "List projects matching a custom view's project filter. Returns an empty connection when the view's modelName is not Project.",
    "projects",
    "ProjectFilter",
    PROJECT_FIELDS,
    "Include projects from sub-teams when the custom view is associated with a team",
  );
  customViewConnectionAction(
    "view.initiatives",
    "List initiatives matching a custom view's initiative filter. Returns an empty connection when the view's modelName is not Initiative.",
    "initiatives",
    "InitiativeFilter",
    INITIATIVE_FIELDS,
  );
  customViewConnectionAction(
    "view.updates",
    "List feed items matching a custom view's feed item filter. Returns an empty connection when the view's modelName is not FeedItem.",
    "updates",
    "FeedItemFilter",
    FEED_ITEM_FIELDS,
    "Include updates from sub-teams when the custom view is associated with a team",
  );
}
