import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  COMMENT_FIELDS,
  ISSUE_FIELDS,
  ISSUE_LITE,
  LIST_INPUT_SCHEMA,
  buildConnArgs,
  gql,
  key,
  type ListOpts,
} from "./shared.js";

export function registerIssueActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.create", {
    description: "Create an issue. teamId is required; title is required unless a template is applied.",
    inputSchema: t.Object({
      teamId: t.String({ description: "The identifier of the team associated with the issue"}),
      title: t.String({ description: "The title of the issue"}),
      description: t.Optional(t.String({ description: "The issue description in markdown format"})),
      assigneeId: t.Optional(t.String({ description: "The identifier of the user to assign the issue to"})),
      priority: t.Optional(t.Number({ description: "Priority. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low"})),
      stateId: t.Optional(t.String({ description: "The team workflow state of the issue"})),
      labelIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the issue labels associated with this ticket"})),
      parentId: t.Optional(t.String({ description: "The identifier of the parent issue. UUID or issue identifier (e.g., 'LIN-123')"})),
      projectId: t.Optional(t.String({ description: "The project associated with the issue"})),
      projectMilestoneId: t.Optional(t.String({ description: "The project milestone associated with the issue"})),
      cycleId: t.Optional(t.String({ description: "The cycle associated with the issue"})),
      estimate: t.Optional(t.Number({ description: "The estimated complexity of the issue (Int)"})),
      dueDate: t.Optional(t.String({ description: "The date at which the issue is due (TimelessDate, YYYY-MM-DD)"})),
      subscriberIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the users subscribing to this ticket"})),
      templateId: t.Optional(t.String({ description: "The identifier of a template the issue should be created from"})),
      useDefaultTemplate: t.Optional(t.Boolean({ description: "Apply the team's default template based on the user's membership"})),
      sortOrder: t.Optional(t.Number({ description: "The position of the issue related to other issues (Float)"})),
      subIssueSortOrder: t.Optional(t.Number({ description: "The position of the issue in its parent's sub-issue list (Float)"})),
      releaseIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the releases to associate with this issue"})),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one"})),
    }),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
        { input: fields },
      );
      return (data.issueCreate as Record<string, unknown>)?.issue;
    },
  });

  rl.registerAction("issue.get", {
    description: "Get an issue by ID or identifier (e.g. 'THE-154')",
    inputSchema: t.Object({ issueId: t.String() }),
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
        { id: (input as { issueId: string }).issueId },
      );
      return data.issue;
    },
  });

  rl.registerAction("issue.list", {
    description: "List issues. Pass `filter` for state/label/project/etc. Default hides archived.",
    inputSchema: t.Object({
      ...LIST_INPUT_SCHEMA,
      teamId: t.Optional(t.String({ description: "Convenience: filter by team"})),
      assigneeId: t.Optional(t.String({ description: "Convenience: filter by assignee"})),
    }),
    async execute(input, ctx) {
      const opts = (input ?? {}) as ListOpts & { teamId?: string; assigneeId?: string };
      // Merge convenience filters into `filter`
      const merged: Record<string, unknown> = { ...(opts.filter ?? {}) };
      if (opts.teamId) merged.team = { id: { eq: opts.teamId } };
      if (opts.assigneeId) merged.assignee = { id: { eq: opts.assigneeId } };
      const filter = Object.keys(merged).length > 0 ? merged : undefined;
      const { argsDecl, argsCall, vars } = buildConnArgs({ ...opts, filter }, "IssueFilter");
      const data = await gql(
        key(ctx),
        `query${argsDecl} { issues${argsCall} { nodes { ${ISSUE_LITE} } pageInfo { hasNextPage endCursor } } }`,
        vars,
      );
      const conn = data.issues as Record<string, unknown>;
      return { nodes: conn.nodes, pageInfo: conn.pageInfo };
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue. All fields optional; only provided fields are updated.",
    inputSchema: t.Object({
      issueId: t.String({ description: "The identifier of the issue to update"}),
      title: t.Optional(t.String({ description: "The issue title"})),
      description: t.Optional(t.String({ description: "The issue description in markdown format"})),
      assigneeId: t.Optional(t.String({ description: "The identifier of the user to assign the issue to"})),
      stateId: t.Optional(t.String({ description: "The team workflow state of the issue"})),
      priority: t.Optional(t.Number({ description: "Priority. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low"})),
      labelIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the issue labels associated with this ticket (replaces all)"})),
      addedLabelIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of issue labels to be added to this issue"})),
      removedLabelIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of issue labels to be removed from this issue"})),
      projectId: t.Optional(t.String({ description: "The project associated with the issue"})),
      projectMilestoneId: t.Optional(t.String({ description: "The project milestone associated with the issue"})),
      cycleId: t.Optional(t.String({ description: "The cycle associated with the issue"})),
      parentId: t.Optional(t.String({ description: "The identifier of the parent issue. UUID or issue identifier (e.g., 'LIN-123')"})),
      teamId: t.Optional(t.String({ description: "The identifier of the team associated with the issue (move issue to a different team)"})),
      estimate: t.Optional(t.Number({ description: "The estimated complexity of the issue (Int)"})),
      dueDate: t.Optional(t.String({ description: "The date at which the issue is due (TimelessDate, YYYY-MM-DD)"})),
      subscriberIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the users subscribing to this ticket"})),
      sortOrder: t.Optional(t.Number({ description: "The position of the issue related to other issues (Float)"})),
      subIssueSortOrder: t.Optional(t.Number({ description: "The position of the issue in its parent's sub-issue list (Float)"})),
      snoozedUntilAt: t.Optional(t.String({ description: "The time until which the issue will be snoozed in Triage view (DateTime)"})),
      releaseIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of the releases associated with this issue (replaces all)"})),
      addedReleaseIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of releases to be added to this issue"})),
      removedReleaseIds: t.Optional(t.Array(t.Unknown(), { description: "The identifiers of releases to be removed from this issue"})),
      trashed: t.Optional(t.Boolean({ description: "Whether the issue has been trashed"})),
    }),
    async execute(input, ctx) {
      const { issueId, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
        { id: issueId, input: fields },
      );
      return (data.issueUpdate as Record<string, unknown>)?.issue;
    },
  });

  rl.registerAction("issue.delete", {
    description: "Trash (soft-delete) an issue. Pass permanentlyDelete=true to bypass 30d grace period (admin only).",
    inputSchema: t.Object({
      issueId: t.String(),
      permanentlyDelete: t.Optional(t.Boolean()),
    }),
    async execute(input, ctx) {
      const { issueId, permanentlyDelete } = input as { issueId: string; permanentlyDelete?: boolean };
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $perm: Boolean) { issueDelete(id: $id, permanentlyDelete: $perm) { success } }`,
        { id: issueId, perm: permanentlyDelete ?? null },
      );
      return data.issueDelete;
    },
  });

  rl.registerAction("issue.archive", {
    description: "Archive an issue.",
    inputSchema: t.Object({
      issueId: t.String(),
      trash: t.Optional(t.Boolean()),
    }),
    async execute(input, ctx) {
      const { issueId, trash } = input as { issueId: string; trash?: boolean };
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $trash: Boolean) { issueArchive(id: $id, trash: $trash) { success } }`,
        { id: issueId, trash: trash ?? null },
      );
      return data.issueArchive;
    },
  });

  rl.registerAction("issue.unarchive", {
    description: "Unarchive an issue.",
    inputSchema: t.Object({ issueId: t.String() }),
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { issueUnarchive(id: $id) { success } }`,
        { id: (input as { issueId: string }).issueId },
      );
      return data.issueUnarchive;
    },
  });

  rl.registerAction("issue.search", {
    description: "Search issues by text query using full-text and vector search. Rate-limited to 30 req/min.",
    inputSchema: t.Object({
      term: t.String({ description: "Search string to look for"}),
      limit: t.Optional(t.Number({ description: "Max results (forward pagination, default 50)"})),
      filter: t.Optional(t.Object({}, { description: "Optional IssueFilter"})),
      includeComments: t.Optional(t.Boolean({ description: "Should associated comments be searched (default false)"})),
      includeArchived: t.Optional(t.Boolean({ description: "Should archived resources be included (default false)"})),
      teamId: t.Optional(t.String({ description: "UUID of a team to boost in search results"})),
      orderBy: t.Optional(t.String({ description: "PaginationOrderBy: createdAt | updatedAt"})),
      after: t.Optional(t.String({ description: "Cursor for forward pagination"})),
      before: t.Optional(t.String({ description: "Cursor for backward pagination"})),
    }),
    async execute(input, ctx) {
      const opts = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `query($term: String!, $first: Int, $filter: IssueFilter, $includeComments: Boolean, $includeArchived: Boolean, $teamId: String, $orderBy: PaginationOrderBy, $after: String, $before: String) {
          searchIssues(term: $term, first: $first, filter: $filter, includeComments: $includeComments, includeArchived: $includeArchived, teamId: $teamId, orderBy: $orderBy, after: $after, before: $before) {
            nodes { ${ISSUE_LITE} }
            totalCount
            pageInfo { hasNextPage endCursor }
          }
        }`,
        {
          term: opts.term,
          first: opts.limit ?? 50,
          filter: opts.filter ?? null,
          includeComments: opts.includeComments ?? null,
          includeArchived: opts.includeArchived ?? null,
          teamId: opts.teamId ?? null,
          orderBy: opts.orderBy ?? null,
          after: opts.after ?? null,
          before: opts.before ?? null,
        },
      );
      return data.searchIssues;
    },
  });

  rl.registerAction("issue.addLabel", {
    description: "Add a single label to an issue.",
    inputSchema: t.Object({
      issueId: t.String(),
      labelId: t.String(),
    }),
    async execute(input, ctx) {
      const { issueId, labelId } = input as { issueId: string; labelId: string };
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $labelId: String!) { issueAddLabel(id: $id, labelId: $labelId) { success } }`,
        { id: issueId, labelId },
      );
      return data.issueAddLabel;
    },
  });

  rl.registerAction("issue.removeLabel", {
    description: "Remove a single label from an issue.",
    inputSchema: t.Object({
      issueId: t.String(),
      labelId: t.String(),
    }),
    async execute(input, ctx) {
      const { issueId, labelId } = input as { issueId: string; labelId: string };
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $labelId: String!) { issueRemoveLabel(id: $id, labelId: $labelId) { success } }`,
        { id: issueId, labelId },
      );
      return data.issueRemoveLabel;
    },
  });

  rl.registerAction("issue.subscribe", {
    description: "Subscribe a user to issue notifications (defaults to current user).",
    inputSchema: t.Object({
      issueId: t.String(),
      userId: t.Optional(t.String()),
      userEmail: t.Optional(t.String()),
    }),
    async execute(input, ctx) {
      const { issueId, userId, userEmail } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $userId: String, $userEmail: String) {
          issueSubscribe(id: $id, userId: $userId, userEmail: $userEmail) { success }
        }`,
        { id: issueId, userId: userId ?? null, userEmail: userEmail ?? null },
      );
      return data.issueSubscribe;
    },
  });

  rl.registerAction("issue.unsubscribe", {
    description: "Unsubscribe a user from issue notifications (defaults to current user).",
    inputSchema: t.Object({
      issueId: t.String(),
      userId: t.Optional(t.String()),
      userEmail: t.Optional(t.String()),
    }),
    async execute(input, ctx) {
      const { issueId, userId, userEmail } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $userId: String, $userEmail: String) {
          issueUnsubscribe(id: $id, userId: $userId, userEmail: $userEmail) { success }
        }`,
        { id: issueId, userId: userId ?? null, userEmail: userEmail ?? null },
      );
      return data.issueUnsubscribe;
    },
  });

  rl.registerAction("issue.addLink", {
    description: "Create a relation between two issues.",
    inputSchema: t.Object({
      issueId: t.String({ description: "The identifier of the issue that is related to another issue. UUID or issue identifier (e.g., 'LIN-123')"}),
      relatedIssueId: t.String({ description: "The identifier of the related issue. UUID or issue identifier (e.g., 'LIN-123')"}),
      type: t.String({ description: "IssueRelationType: blocks | duplicate | related | similar"}),
    }),
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success issueRelation { id type } } }`,
        { input: input as Record<string, unknown> },
      );
      return data.issueRelationCreate;
    },
  });

  rl.registerAction("issue.listComments", {
    description: "List comments on an issue.",
    inputSchema: t.Object({
      issueId: t.String(),
      limit: t.Optional(t.Number()),
    }),
    async execute(input, ctx) {
      const { issueId, limit } = input as { issueId: string; limit?: number };
      const data = await gql(
        key(ctx),
        `query($id: String!, $first: Int) {
          issue(id: $id) { comments(first: $first) { nodes { ${COMMENT_FIELDS} } } }
        }`,
        { id: issueId, first: limit ?? 50 },
      );
      return ((data.issue as Record<string, unknown>)?.comments as Record<string, unknown>)?.nodes;
    },
  });
}
