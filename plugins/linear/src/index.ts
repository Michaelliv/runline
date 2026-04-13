import type { RunlinePluginAPI } from "runline";

const GQL_URL = "https://api.linear.app/graphql";

async function gql(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errors) throw new Error(`Linear GraphQL error: ${JSON.stringify(data.errors)}`);
  return data.data as Record<string, unknown>;
}

export default function linear(rl: RunlinePluginAPI) {
  rl.setName("linear");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "Linear API key", env: "LINEAR_API_KEY" } });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("issue.create", {
    description: "Create an issue",
    inputSchema: {
      teamId: { type: "string", required: true, description: "Team ID" },
      title: { type: "string", required: true, description: "Issue title" },
      description: { type: "string", required: false, description: "Issue description (markdown)" },
      assigneeId: { type: "string", required: false, description: "Assignee user ID" },
      priority: { type: "number", required: false, description: "Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)" },
      stateId: { type: "string", required: false, description: "Workflow state ID" },
      labelIds: { type: "array", required: false, description: "Label IDs" },
      parentId: { type: "string", required: false, description: "Parent issue ID (for sub-issues)" },
    },
    async execute(input, ctx) {
      const { teamId, title, description: desc, assigneeId, priority, stateId, labelIds, parentId } = input as Record<string, unknown>;
      const vars: Record<string, unknown> = { teamId, title };
      if (desc) vars.description = desc;
      if (assigneeId) vars.assigneeId = assigneeId;
      if (priority !== undefined) vars.priority = priority;
      if (stateId) vars.stateId = stateId;
      if (labelIds) vars.labelIds = labelIds;
      if (parentId) vars.parentId = parentId;
      const data = await gql(key(ctx), `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`, { input: vars });
      return (data.issueCreate as Record<string, unknown>)?.issue;
    },
  });

  rl.registerAction("issue.get", {
    description: "Get an issue by ID",
    inputSchema: { issueId: { type: "string", required: true, description: "Issue ID" } },
    async execute(input, ctx) {
      const data = await gql(key(ctx), `query($id: String!) { issue(id: $id) { id identifier title description url priority state { id name } assignee { id name } labels { nodes { id name } } createdAt updatedAt } }`, { id: (input as { issueId: string }).issueId });
      return data.issue;
    },
  });

  rl.registerAction("issue.list", {
    description: "List issues",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results (default: 50)" },
      teamId: { type: "string", required: false, description: "Filter by team" },
      assigneeId: { type: "string", required: false, description: "Filter by assignee" },
    },
    async execute(input, ctx) {
      const { limit = 50, teamId, assigneeId } = (input ?? {}) as Record<string, unknown>;
      let filter = "";
      const filterParts: string[] = [];
      if (teamId) filterParts.push(`team: { id: { eq: "${teamId}" } }`);
      if (assigneeId) filterParts.push(`assignee: { id: { eq: "${assigneeId}" } }`);
      if (filterParts.length > 0) filter = `, filter: { ${filterParts.join(", ")} }`;
      const data = await gql(key(ctx), `query { issues(first: ${limit}${filter}) { nodes { id identifier title url priority state { name } assignee { name } createdAt } } }`);
      return (data.issues as Record<string, unknown>)?.nodes;
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue",
    inputSchema: {
      issueId: { type: "string", required: true, description: "Issue ID" },
      title: { type: "string", required: false, description: "New title" },
      description: { type: "string", required: false, description: "New description" },
      assigneeId: { type: "string", required: false, description: "Assignee ID" },
      stateId: { type: "string", required: false, description: "State ID" },
      priority: { type: "number", required: false, description: "Priority" },
      labelIds: { type: "array", required: false, description: "Label IDs" },
    },
    async execute(input, ctx) {
      const { issueId, ...fields } = input as Record<string, unknown>;
      const data = await gql(key(ctx), `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title url } } }`, { id: issueId, input: fields });
      return (data.issueUpdate as Record<string, unknown>)?.issue;
    },
  });

  rl.registerAction("issue.delete", {
    description: "Delete an issue",
    inputSchema: { issueId: { type: "string", required: true, description: "Issue ID" } },
    async execute(input, ctx) {
      const data = await gql(key(ctx), `mutation($id: String!) { issueDelete(id: $id) { success } }`, { id: (input as { issueId: string }).issueId });
      return data.issueDelete;
    },
  });

  rl.registerAction("issue.addComment", {
    description: "Add a comment to an issue",
    inputSchema: {
      issueId: { type: "string", required: true, description: "Issue ID" },
      body: { type: "string", required: true, description: "Comment body (markdown)" },
    },
    async execute(input, ctx) {
      const { issueId, body: commentBody } = input as Record<string, unknown>;
      const data = await gql(key(ctx), `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body createdAt } } }`, { input: { issueId, body: commentBody } });
      return (data.commentCreate as Record<string, unknown>)?.comment;
    },
  });

  rl.registerAction("issue.addLink", {
    description: "Add a link/relation between issues",
    inputSchema: {
      issueId: { type: "string", required: true, description: "Source issue ID" },
      relatedIssueId: { type: "string", required: true, description: "Related issue ID" },
      type: { type: "string", required: true, description: "Relation type: relates, blocks, duplicate" },
    },
    async execute(input, ctx) {
      const { issueId, relatedIssueId, type } = input as Record<string, unknown>;
      const data = await gql(key(ctx), `mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`, { input: { issueId, relatedIssueId, type } });
      return data.issueRelationCreate;
    },
  });
}
