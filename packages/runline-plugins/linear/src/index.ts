import type { RunlinePluginAPI } from "runline";

const GQL_URL = "https://api.linear.app/graphql";

type Ctx = { connection: { config: Record<string, unknown> } };

async function gql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errors)
    throw new Error(`Linear GraphQL error: ${JSON.stringify(data.errors)}`);
  return data.data as Record<string, unknown>;
}

// ---------- selection sets (kept compact, repeated by name) ----------
const ISSUE_FIELDS = `id identifier title description url priority estimate dueDate
  state { id name type } assignee { id name email } creator { id name }
  team { id key name } project { id name } cycle { id number name }
  projectMilestone { id name } parent { id identifier }
  labels { nodes { id name color } }
  createdAt updatedAt completedAt canceledAt archivedAt`;
const ISSUE_LITE = `id identifier title url priority state { id name type } assignee { id name } team { key } updatedAt`;
const COMMENT_FIELDS = `id body url issue { id identifier } user { id name } parent { id } createdAt updatedAt editedAt resolvedAt`;
const STATE_FIELDS = `id name type color position description team { id key }`;
const LABEL_FIELDS = `id name color description isGroup parent { id name } team { id key } createdAt`;
const PROJECT_FIELDS = `id name description url icon color priority progress health
  state status { id name type } lead { id name } startDate targetDate
  teams { nodes { id key } } createdAt updatedAt completedAt canceledAt`;
const MILESTONE_FIELDS = `id name description targetDate sortOrder project { id name } createdAt updatedAt`;
const PROJECT_UPDATE_FIELDS = `id body health url user { id name } project { id name } createdAt`;
const CYCLE_FIELDS = `id number name description startsAt endsAt completedAt progress team { id key } createdAt`;
const INITIATIVE_FIELDS = `id name description url icon color status targetDate owner { id name }
  projects { nodes { id name } } createdAt updatedAt completedAt`;
const TEAM_FIELDS = `id key name description icon color private timezone
  cyclesEnabled cycleDuration issueEstimationType triageEnabled
  parent { id key } createdAt`;
const USER_FIELDS = `id name displayName email avatarUrl active admin guest
  isMe statusEmoji statusLabel createdAt`;
const ATTACHMENT_FIELDS = `id title subtitle url sourceType groupBySource metadata
  issue { id identifier } creator { id name } createdAt updatedAt`;
const ORG_FIELDS = `id name urlKey logoUrl userCount createdIssueCount
  periodUploadVolume samlEnabled scimEnabled createdAt`;
const WEBHOOK_FIELDS = `id label url enabled resourceTypes secret
  team { id key } allPublicTeams createdAt`;

// ---------- pagination + filter helper ----------
//
// Linear `Connection` queries accept: first/last, after/before, filter,
// includeArchived, orderBy. We expose a flat surface and forward what's set.
type ListOpts = {
  limit?: number;
  filter?: Record<string, unknown>;
  includeArchived?: boolean;
  orderBy?: string; // "createdAt" | "updatedAt"
  after?: string;
  before?: string;
};

function buildConnArgs(opts: ListOpts, filterTypeName: string | null): {
  argsDecl: string;
  argsCall: string;
  vars: Record<string, unknown>;
} {
  const declParts: string[] = [];
  const callParts: string[] = [`first: $first`];
  const vars: Record<string, unknown> = { first: opts.limit ?? 50 };
  declParts.push(`$first: Int`);
  if (filterTypeName && opts.filter !== undefined) {
    declParts.push(`$filter: ${filterTypeName}`);
    callParts.push(`filter: $filter`);
    vars.filter = opts.filter;
  }
  if (opts.includeArchived !== undefined) {
    declParts.push(`$includeArchived: Boolean`);
    callParts.push(`includeArchived: $includeArchived`);
    vars.includeArchived = opts.includeArchived;
  }
  if (opts.orderBy !== undefined) {
    declParts.push(`$orderBy: PaginationOrderBy`);
    callParts.push(`orderBy: $orderBy`);
    vars.orderBy = opts.orderBy;
  }
  if (opts.after !== undefined) {
    declParts.push(`$after: String`);
    callParts.push(`after: $after`);
    vars.after = opts.after;
  }
  if (opts.before !== undefined) {
    declParts.push(`$before: String`);
    callParts.push(`before: $before`);
    vars.before = opts.before;
  }
  return {
    argsDecl: `(${declParts.join(", ")})`,
    argsCall: `(${callParts.join(", ")})`,
    vars,
  };
}

// Common list-input schema reused across resources
const LIST_INPUT_SCHEMA = {
  limit: { type: "number", required: false, description: "Max results (default 50, max 250)" },
  filter: { type: "object", required: false, description: "Linear filter object (see schema for the resource)" },
  includeArchived: { type: "boolean", required: false, description: "Include archived items" },
  orderBy: { type: "string", required: false, description: "createdAt | updatedAt" },
  after: { type: "string", required: false, description: "Cursor for forward pagination" },
  before: { type: "string", required: false, description: "Cursor for backward pagination" },
} as const;

// ---------- plugin ----------

export default function linear(rl: RunlinePluginAPI) {
  rl.setName("linear");
  rl.setVersion("0.3.0");
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Linear API key (https://linear.app/settings/account/security)",
      env: "LINEAR_API_KEY",
    },
  });

  const key = (ctx: Ctx) => ctx.connection.config.apiKey as string;

  // Shared helpers for connection-style listing
  function listAction(
    name: string,
    description: string,
    rootField: string,
    filterTypeName: string | null,
    selection: string,
  ) {
    rl.registerAction(name, {
      description,
      inputSchema: { ...LIST_INPUT_SCHEMA },
      async execute(input, ctx) {
        const opts = (input ?? {}) as ListOpts;
        const { argsDecl, argsCall, vars } = buildConnArgs(opts, filterTypeName);
        const data = await gql(
          key(ctx),
          `query${argsDecl} { ${rootField}${argsCall} { nodes { ${selection} } pageInfo { hasNextPage endCursor } } }`,
          vars,
        );
        const conn = data[rootField] as Record<string, unknown>;
        return { nodes: conn.nodes, pageInfo: conn.pageInfo };
      },
    });
  }

  function getAction(
    name: string,
    description: string,
    rootField: string,
    selection: string,
  ) {
    rl.registerAction(name, {
      description,
      inputSchema: { id: { type: "string", required: true, description: "Identifier or slug" } },
      async execute(input, ctx) {
        const data = await gql(
          key(ctx),
          `query($id: String!) { ${rootField}(id: $id) { ${selection} } }`,
          { id: (input as { id: string }).id },
        );
        return data[rootField];
      },
    });
  }

  // =========================================================
  // Issues
  // =========================================================

  rl.registerAction("issue.create", {
    description: "Create an issue. teamId is required; title is required unless a template is applied.",
    inputSchema: {
      teamId: { type: "string", required: true, description: "The identifier of the team associated with the issue" },
      title: { type: "string", required: true, description: "The title of the issue" },
      description: { type: "string", required: false, description: "The issue description in markdown format" },
      assigneeId: { type: "string", required: false, description: "The identifier of the user to assign the issue to" },
      priority: { type: "number", required: false, description: "Priority. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low" },
      stateId: { type: "string", required: false, description: "The team workflow state of the issue" },
      labelIds: { type: "array", required: false, description: "The identifiers of the issue labels associated with this ticket" },
      parentId: { type: "string", required: false, description: "The identifier of the parent issue. UUID or issue identifier (e.g., 'LIN-123')" },
      projectId: { type: "string", required: false, description: "The project associated with the issue" },
      projectMilestoneId: { type: "string", required: false, description: "The project milestone associated with the issue" },
      cycleId: { type: "string", required: false, description: "The cycle associated with the issue" },
      estimate: { type: "number", required: false, description: "The estimated complexity of the issue (Int)" },
      dueDate: { type: "string", required: false, description: "The date at which the issue is due (TimelessDate, YYYY-MM-DD)" },
      subscriberIds: { type: "array", required: false, description: "The identifiers of the users subscribing to this ticket" },
      templateId: { type: "string", required: false, description: "The identifier of a template the issue should be created from" },
      useDefaultTemplate: { type: "boolean", required: false, description: "Apply the team's default template based on the user's membership" },
      sortOrder: { type: "number", required: false, description: "The position of the issue related to other issues (Float)" },
      subIssueSortOrder: { type: "number", required: false, description: "The position of the issue in its parent's sub-issue list (Float)" },
      releaseIds: { type: "array", required: false, description: "The identifiers of the releases to associate with this issue" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
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
    inputSchema: { issueId: { type: "string", required: true } },
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
    inputSchema: {
      ...LIST_INPUT_SCHEMA,
      teamId: { type: "string", required: false, description: "Convenience: filter by team" },
      assigneeId: { type: "string", required: false, description: "Convenience: filter by assignee" },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true, description: "The identifier of the issue to update" },
      title: { type: "string", required: false, description: "The issue title" },
      description: { type: "string", required: false, description: "The issue description in markdown format" },
      assigneeId: { type: "string", required: false, description: "The identifier of the user to assign the issue to" },
      stateId: { type: "string", required: false, description: "The team workflow state of the issue" },
      priority: { type: "number", required: false, description: "Priority. 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low" },
      labelIds: { type: "array", required: false, description: "The identifiers of the issue labels associated with this ticket (replaces all)" },
      addedLabelIds: { type: "array", required: false, description: "The identifiers of issue labels to be added to this issue" },
      removedLabelIds: { type: "array", required: false, description: "The identifiers of issue labels to be removed from this issue" },
      projectId: { type: "string", required: false, description: "The project associated with the issue" },
      projectMilestoneId: { type: "string", required: false, description: "The project milestone associated with the issue" },
      cycleId: { type: "string", required: false, description: "The cycle associated with the issue" },
      parentId: { type: "string", required: false, description: "The identifier of the parent issue. UUID or issue identifier (e.g., 'LIN-123')" },
      teamId: { type: "string", required: false, description: "The identifier of the team associated with the issue (move issue to a different team)" },
      estimate: { type: "number", required: false, description: "The estimated complexity of the issue (Int)" },
      dueDate: { type: "string", required: false, description: "The date at which the issue is due (TimelessDate, YYYY-MM-DD)" },
      subscriberIds: { type: "array", required: false, description: "The identifiers of the users subscribing to this ticket" },
      sortOrder: { type: "number", required: false, description: "The position of the issue related to other issues (Float)" },
      subIssueSortOrder: { type: "number", required: false, description: "The position of the issue in its parent's sub-issue list (Float)" },
      snoozedUntilAt: { type: "string", required: false, description: "The time until which the issue will be snoozed in Triage view (DateTime)" },
      releaseIds: { type: "array", required: false, description: "The identifiers of the releases associated with this issue (replaces all)" },
      addedReleaseIds: { type: "array", required: false, description: "The identifiers of releases to be added to this issue" },
      removedReleaseIds: { type: "array", required: false, description: "The identifiers of releases to be removed from this issue" },
      trashed: { type: "boolean", required: false, description: "Whether the issue has been trashed" },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      permanentlyDelete: { type: "boolean", required: false },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      trash: { type: "boolean", required: false },
    },
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
    inputSchema: { issueId: { type: "string", required: true } },
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
    inputSchema: {
      term: { type: "string", required: true, description: "Search string to look for" },
      limit: { type: "number", required: false, description: "Max results (forward pagination, default 50)" },
      filter: { type: "object", required: false, description: "Optional IssueFilter" },
      includeComments: { type: "boolean", required: false, description: "Should associated comments be searched (default false)" },
      includeArchived: { type: "boolean", required: false, description: "Should archived resources be included (default false)" },
      teamId: { type: "string", required: false, description: "UUID of a team to boost in search results" },
      orderBy: { type: "string", required: false, description: "PaginationOrderBy: createdAt | updatedAt" },
      after: { type: "string", required: false, description: "Cursor for forward pagination" },
      before: { type: "string", required: false, description: "Cursor for backward pagination" },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      labelId: { type: "string", required: true },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      labelId: { type: "string", required: true },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      userId: { type: "string", required: false },
      userEmail: { type: "string", required: false },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      userId: { type: "string", required: false },
      userEmail: { type: "string", required: false },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true, description: "The identifier of the issue that is related to another issue. UUID or issue identifier (e.g., 'LIN-123')" },
      relatedIssueId: { type: "string", required: true, description: "The identifier of the related issue. UUID or issue identifier (e.g., 'LIN-123')" },
      type: { type: "string", required: true, description: "IssueRelationType: blocks | duplicate | related | similar" },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
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

  // =========================================================
  // Comments
  // =========================================================

  rl.registerAction("issue.addComment", {
    description: "Add a comment to an issue. Pass parentId to nest as a reply.",
    inputSchema: {
      issueId: { type: "string", required: true, description: "The issue to associate the comment with. UUID or issue identifier (e.g., 'LIN-123')" },
      body: { type: "string", required: true, description: "The comment content in markdown format" },
      parentId: { type: "string", required: false, description: "The parent comment under which to nest this comment" },
      doNotSubscribeToIssue: { type: "boolean", required: false, description: "Prevent auto-subscription to the issue the comment is created on" },
      quotedText: { type: "string", required: false, description: "The text that this comment references (inline comments)" },
    },
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
        { input: fields },
      );
      return (data.commentCreate as Record<string, unknown>)?.comment;
    },
  });

  listAction("comment.list", "List comments across the workspace.", "comments", "CommentFilter", COMMENT_FIELDS);
  rl.registerAction("comment.get", {
    description: "Get a comment by ID.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `query($id: String!) { comment(id: $id) { ${COMMENT_FIELDS} } }`,
        { id: (input as { id: string }).id },
      );
      return data.comment;
    },
  });
  rl.registerAction("comment.update", {
    description: "Update a comment.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the comment to update" },
      body: { type: "string", required: false, description: "The comment content in markdown format" },
      quotedText: { type: "string", required: false, description: "The text that this comment references (inline comments)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.commentUpdate as Record<string, unknown>)?.comment;
    },
  });
  rl.registerAction("comment.delete", {
    description: "Delete a comment.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { commentDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.commentDelete;
    },
  });

  // =========================================================
  // Workflow States
  // =========================================================

  listAction("state.list", "List workflow states. Filter by team for team-scoped states.", "workflowStates", "WorkflowStateFilter", STATE_FIELDS);
  getAction("state.get", "Get a workflow state by ID.", "workflowState", STATE_FIELDS);
  rl.registerAction("state.create", {
    description: "Create a workflow state in a team.",
    inputSchema: {
      teamId: { type: "string", required: true, description: "The team associated with the state" },
      name: { type: "string", required: true, description: "The name of the state" },
      type: { type: "string", required: true, description: "The workflow state type which categorizes the state. Valid values: backlog, unstarted, started, completed, canceled" },
      color: { type: "string", required: true, description: "The color of the state (hex, e.g. #6B7280)" },
      description: { type: "string", required: false, description: "The description of the state" },
      position: { type: "number", required: false, description: "The position of the state (Float)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.workflowStateCreate as Record<string, unknown>)?.workflowState;
    },
  });
  rl.registerAction("state.update", {
    description: "Update a workflow state. Type cannot be changed after creation.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the state to update" },
      name: { type: "string", required: false, description: "The name of the state" },
      color: { type: "string", required: false, description: "The color of the state (hex)" },
      description: { type: "string", required: false, description: "The description of the state" },
      position: { type: "number", required: false, description: "The position of the state (Float)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: WorkflowStateUpdateInput!) { workflowStateUpdate(id: $id, input: $input) { success workflowState { ${STATE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.workflowStateUpdate as Record<string, unknown>)?.workflowState;
    },
  });

  // =========================================================
  // Labels
  // =========================================================

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

  // =========================================================
  // Projects
  // =========================================================

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

  // =========================================================
  // Project Milestones
  // =========================================================

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

  // =========================================================
  // Project Updates (status posts)
  // =========================================================

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

  // =========================================================
  // Cycles
  // =========================================================

  listAction("cycle.list", "List cycles. Use filter for isActive/isNext/isPrevious.", "cycles", "CycleFilter", CYCLE_FIELDS);
  getAction("cycle.get", "Get a cycle by ID.", "cycle", CYCLE_FIELDS);
  rl.registerAction("cycle.create", {
    description: "Create a cycle for a team.",
    inputSchema: {
      teamId: { type: "string", required: true, description: "The team to associate the cycle with" },
      startsAt: { type: "string", required: true, description: "The start time of the cycle (DateTime, ISO 8601)" },
      endsAt: { type: "string", required: true, description: "The end time of the cycle (DateTime, ISO 8601)" },
      name: { type: "string", required: false, description: "The custom name of the cycle" },
      description: { type: "string", required: false, description: "The description of the cycle" },
      completedAt: { type: "string", required: false, description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: CycleCreateInput!) { cycleCreate(input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.cycleCreate as Record<string, unknown>)?.cycle;
    },
  });
  rl.registerAction("cycle.update", {
    description: "Update a cycle.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the cycle to update" },
      name: { type: "string", required: false, description: "The custom name of the cycle" },
      description: { type: "string", required: false, description: "The description of the cycle" },
      startsAt: { type: "string", required: false, description: "The start time of the cycle (DateTime, ISO 8601)" },
      endsAt: { type: "string", required: false, description: "The end time of the cycle (DateTime, ISO 8601)" },
      completedAt: { type: "string", required: false, description: "The completion time of the cycle (DateTime). If null, the cycle hasn't been completed" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CycleUpdateInput!) { cycleUpdate(id: $id, input: $input) { success cycle { ${CYCLE_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.cycleUpdate as Record<string, unknown>)?.cycle;
    },
  });

  // =========================================================
  // Initiatives
  // =========================================================

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

  // =========================================================
  // Teams
  // =========================================================

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

  // =========================================================
  // Users
  // =========================================================

  listAction("user.list", "List users in the workspace.", "users", "UserFilter", USER_FIELDS);
  getAction("user.get", "Get a user by ID. Use 'me' to reference the authenticated user.", "user", USER_FIELDS);
  rl.registerAction("user.me", {
    description: "Get the authenticated user.",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = await gql(key(ctx), `query { viewer { ${USER_FIELDS} } }`);
      return data.viewer;
    },
  });
  rl.registerAction("user.update", {
    description: "Update a user. Use id='me' to update the authenticated user.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the user to update. Use 'me' to reference the currently authenticated user" },
      name: { type: "string", required: false, description: "The name of the user" },
      displayName: { type: "string", required: false, description: "The display name of the user" },
      description: { type: "string", required: false, description: "The user description or short bio" },
      avatarUrl: { type: "string", required: false, description: "The avatar image URL of the user" },
      timezone: { type: "string", required: false, description: "The local timezone of the user" },
      title: { type: "string", required: false, description: "The user's job title" },
      statusEmoji: { type: "string", required: false, description: "The emoji part of the user status" },
      statusLabel: { type: "string", required: false, description: "The label part of the user status" },
      statusUntilAt: { type: "string", required: false, description: "When the user status should be cleared (DateTime)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: UserUpdateInput!) { userUpdate(id: $id, input: $input) { success user { ${USER_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.userUpdate as Record<string, unknown>)?.user;
    },
  });

  // =========================================================
  // Attachments
  // =========================================================

  listAction("attachment.list", "List issue attachments.", "attachments", "AttachmentFilter", ATTACHMENT_FIELDS);
  getAction("attachment.get", "Get an attachment by ID.", "attachment", ATTACHMENT_FIELDS);
  rl.registerAction("attachment.create", {
    description: "Create an attachment on an issue.",
    inputSchema: {
      issueId: { type: "string", required: true, description: "The issue to associate the attachment with. UUID or issue identifier (e.g., 'LIN-123')" },
      title: { type: "string", required: true, description: "The attachment title" },
      url: { type: "string", required: true, description: "Attachment location, also used as a unique identifier. Re-creating with the same url updates the existing record" },
      subtitle: { type: "string", required: false, description: "The attachment subtitle" },
      iconUrl: { type: "string", required: false, description: "An icon url to display with the attachment (jpg or png, max 1MB, ideally 20x20px)" },
      commentBody: { type: "string", required: false, description: "Create a linked comment with markdown body" },
      groupBySource: { type: "boolean", required: false, description: "Whether attachments for the same source application should be grouped in the Linear UI" },
      metadata: { type: "object", required: false, description: "Attachment metadata object with string and number values (JSONObject)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.attachmentCreate as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.update", {
    description: "Update an attachment. title is required.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the attachment to update" },
      title: { type: "string", required: true, description: "The attachment title" },
      subtitle: { type: "string", required: false, description: "The attachment subtitle" },
      iconUrl: { type: "string", required: false, description: "An icon url to display with the attachment" },
      metadata: { type: "object", required: false, description: "Attachment metadata object with string and number values (JSONObject)" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: AttachmentUpdateInput!) { attachmentUpdate(id: $id, input: $input) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.attachmentUpdate as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.linkURL", {
    description: "Link any URL to an issue. If a workspace integration matches the URL (Zendesk, GitHub, Slack, etc.) a rich attachment is created; otherwise a basic one.",
    inputSchema: {
      issueId: { type: "string", required: true, description: "The issue for which to link the url. UUID or issue identifier (e.g., 'LIN-123')" },
      url: { type: "string", required: true, description: "The url to link" },
      title: { type: "string", required: false, description: "The title to use for the attachment" },
      id: { type: "string", required: false, description: "The id for the attachment (optional UUID override)" },
    },
    async execute(input, ctx) {
      const { issueId, url, title, id } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($issueId: String!, $url: String!, $title: String, $id: String) {
          attachmentLinkURL(issueId: $issueId, url: $url, title: $title, id: $id) { success attachment { ${ATTACHMENT_FIELDS} } }
        }`,
        { issueId, url, title: title ?? null, id: id ?? null },
      );
      return (data.attachmentLinkURL as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.delete", {
    description: "Delete an attachment.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the attachment to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { attachmentDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.attachmentDelete;
    },
  });

  // =========================================================
  // Organization
  // =========================================================

  rl.registerAction("org.get", {
    description: "Get the authenticated workspace.",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = await gql(key(ctx), `query { organization { ${ORG_FIELDS} } }`);
      return data.organization;
    },
  });

  // =========================================================
  // Webhooks
  // =========================================================

  listAction("webhook.list", "List webhooks for the current workspace.", "webhooks", null, WEBHOOK_FIELDS);
  getAction("webhook.get", "Get a webhook by ID.", "webhook", WEBHOOK_FIELDS);
  rl.registerAction("webhook.create", {
    description: "Create a webhook. resourceTypes example: ['Issue','Comment','Project'].",
    inputSchema: {
      url: { type: "string", required: true, description: "The URL that will be called on data changes" },
      resourceTypes: { type: "array", required: true, description: "List of resources the webhook should subscribe to (e.g. ['Issue','Comment'])" },
      label: { type: "string", required: false, description: "Label for the webhook" },
      teamId: { type: "string", required: false, description: "The identifier or key of the team associated with the webhook. Omit and set allPublicTeams=true for workspace-wide" },
      allPublicTeams: { type: "boolean", required: false, description: "Whether this webhook is enabled for all public teams" },
      enabled: { type: "boolean", required: false, description: "Whether this webhook is enabled (default true)" },
      secret: { type: "string", required: false, description: "A secret token used to sign the webhook payload" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { ${WEBHOOK_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.webhookCreate as Record<string, unknown>)?.webhook;
    },
  });
  rl.registerAction("webhook.update", {
    description: "Update a webhook. teamId and allPublicTeams cannot be changed after creation.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the webhook to update" },
      url: { type: "string", required: false, description: "The URL that will be called on data changes" },
      resourceTypes: { type: "array", required: false, description: "List of resources the webhook should subscribe to" },
      label: { type: "string", required: false, description: "Label for the webhook" },
      enabled: { type: "boolean", required: false, description: "Whether this webhook is enabled" },
      secret: { type: "string", required: false, description: "A secret token used to sign the webhook payload" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: WebhookUpdateInput!) { webhookUpdate(id: $id, input: $input) { success webhook { ${WEBHOOK_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.webhookUpdate as Record<string, unknown>)?.webhook;
    },
  });
  rl.registerAction("webhook.delete", {
    description: "Delete a webhook.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the webhook to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { webhookDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.webhookDelete;
    },
  });
  rl.registerAction("webhook.rotateSecret", {
    description: "Rotate a webhook's signing secret. Returns the new secret.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the webhook to rotate the secret for" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { webhookRotateSecret(id: $id) { success secret } }`,
        { id: (input as { id: string }).id },
      );
      return data.webhookRotateSecret;
    },
  });
}
