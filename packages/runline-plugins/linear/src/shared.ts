import type { RunlinePluginAPI } from "runline";

const GQL_URL = "https://api.linear.app/graphql";

export type Ctx = { connection: { config: Record<string, unknown> } };

export async function gql(
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

export function key(ctx: Ctx) {
  return ctx.connection.config.apiKey as string;
}

export const ISSUE_FIELDS = `id identifier title description url priority estimate dueDate
  state { id name type } assignee { id name email } creator { id name }
  team { id key name } project { id name } cycle { id number name }
  projectMilestone { id name } parent { id identifier }
  labels { nodes { id name color } }
  createdAt updatedAt completedAt canceledAt archivedAt`;
export const ISSUE_LITE = `id identifier title url priority state { id name type } assignee { id name } team { key } updatedAt`;
export const COMMENT_FIELDS = `id body url issue { id identifier } user { id name } parent { id } createdAt updatedAt editedAt resolvedAt`;
export const STATE_FIELDS = `id name type color position description team { id key }`;
export const LABEL_FIELDS = `id name color description isGroup parent { id name } team { id key } createdAt`;
export const PROJECT_FIELDS = `id name description url icon color priority progress health
  state status { id name type } lead { id name } startDate targetDate
  teams { nodes { id key } } createdAt updatedAt completedAt canceledAt`;
export const MILESTONE_FIELDS = `id name description targetDate sortOrder project { id name } createdAt updatedAt`;
export const PROJECT_UPDATE_FIELDS = `id body health url user { id name } project { id name } createdAt`;
export const FEED_ITEM_FIELDS = `id createdAt updatedAt archivedAt team { id key name } user { id name }
  projectUpdate { ${PROJECT_UPDATE_FIELDS} }
  initiativeUpdate { id body health url user { id name } initiative { id name } createdAt }
  post { id title body slugId type creator { id name } createdAt updatedAt }`;
export const CUSTOM_VIEW_FIELDS = `id name description icon color shared slugId modelName
  filterData projectFilterData initiativeFilterData feedItemFilterData
  team { id key name } owner { id name } creator { id name }
  createdAt updatedAt archivedAt`;
export const CYCLE_FIELDS = `id number name description startsAt endsAt completedAt progress team { id key } createdAt`;
export const INITIATIVE_FIELDS = `id name description url icon color status targetDate owner { id name }
  projects { nodes { id name } } createdAt updatedAt completedAt`;
export const TEAM_FIELDS = `id key name description icon color private timezone
  cyclesEnabled cycleDuration issueEstimationType triageEnabled
  parent { id key } createdAt`;
export const USER_FIELDS = `id name displayName email avatarUrl active admin guest
  isMe statusEmoji statusLabel createdAt`;
export const ATTACHMENT_FIELDS = `id title subtitle url sourceType groupBySource metadata
  issue { id identifier } creator { id name } createdAt updatedAt`;
export const ORG_FIELDS = `id name urlKey logoUrl userCount createdIssueCount
  periodUploadVolume samlEnabled scimEnabled createdAt`;
export const WEBHOOK_FIELDS = `id label url enabled resourceTypes secret
  team { id key } allPublicTeams createdAt`;

export type ListOpts = {
  limit?: number;
  filter?: Record<string, unknown>;
  includeArchived?: boolean;
  orderBy?: string;
  after?: string;
  before?: string;
};

export function buildConnArgs(opts: ListOpts, filterTypeName: string | null): {
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

export const LIST_INPUT_SCHEMA = {
  limit: { type: "number", required: false, description: "Max results (default 50, max 250)" },
  filter: { type: "object", required: false, description: "Linear filter object (see schema for the resource)" },
  includeArchived: { type: "boolean", required: false, description: "Include archived items" },
  orderBy: { type: "string", required: false, description: "createdAt | updatedAt" },
  after: { type: "string", required: false, description: "Cursor for forward pagination" },
  before: { type: "string", required: false, description: "Cursor for backward pagination" },
} as const;

export type ListActionArgs = [
  name: string,
  description: string,
  rootField: string,
  filterTypeName: string | null,
  selection: string,
];

export type GetActionArgs = [
  name: string,
  description: string,
  rootField: string,
  selection: string,
];

export function bindListAction(rl: RunlinePluginAPI) {
  return (...args: ListActionArgs) => registerListAction(rl, ...args);
}

export function bindGetAction(rl: RunlinePluginAPI) {
  return (...args: GetActionArgs) => registerGetAction(rl, ...args);
}

export function registerListAction(
  rl: RunlinePluginAPI,
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

export function registerGetAction(
  rl: RunlinePluginAPI,
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
