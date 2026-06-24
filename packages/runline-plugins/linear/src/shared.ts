import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";

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

export function scopeLabelIds(ctx: Ctx): string[] {
  const raw = ctx.connection.config.scopeLabelIds;
  if (Array.isArray(raw))
    return raw
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isScoped(ctx: Ctx): boolean {
  return scopeLabelIds(ctx).length > 0;
}

export function mergeIssueScopeFilter(
  ctx: Ctx,
  filter?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const ids = scopeLabelIds(ctx);
  if (ids.length === 0) return filter;
  const scopeFilter = { labels: { id: { in: ids } } };
  if (!filter || Object.keys(filter).length === 0) return scopeFilter;
  return { and: [filter, scopeFilter] };
}

export function issueHasScope(ctx: Ctx, issue: unknown): boolean {
  const ids = new Set(scopeLabelIds(ctx));
  if (ids.size === 0) return true;
  const labels = (
    (issue as Record<string, unknown> | null)?.labels as
      | Record<string, unknown>
      | undefined
  )?.nodes;
  return (
    Array.isArray(labels) &&
    labels.some((label) =>
      ids.has(String((label as Record<string, unknown>).id)),
    )
  );
}

export async function getIssueForScope(
  ctx: Ctx,
  issueId: string,
): Promise<Record<string, unknown> | null> {
  const data = await gql(
    key(ctx),
    `query($id: String!) { issue(id: $id) { id identifier labels { nodes { id name } } } }`,
    { id: issueId },
  );
  return (data.issue as Record<string, unknown> | null) ?? null;
}

export async function assertIssueInScope(
  ctx: Ctx,
  issueId: string,
): Promise<Record<string, unknown> | null> {
  if (!isScoped(ctx)) return null;
  const issue = await getIssueForScope(ctx, issueId);
  if (!issue || !issueHasScope(ctx, issue))
    throw new Error("Linear issue is not available to this scoped connection");
  return issue;
}

export async function assertCommentInScope(
  ctx: Ctx,
  commentId: string,
): Promise<void> {
  if (!isScoped(ctx)) return;
  const data = await gql(
    key(ctx),
    `query($id: String!) { comment(id: $id) { id issue { id identifier labels { nodes { id name } } } } }`,
    { id: commentId },
  );
  const issue = (data.comment as Record<string, unknown> | null)?.issue;
  if (!issue || !issueHasScope(ctx, issue))
    throw new Error(
      "Linear comment is not available to this scoped connection",
    );
}

export async function assertAttachmentInScope(
  ctx: Ctx,
  attachmentId: string,
): Promise<void> {
  if (!isScoped(ctx)) return;
  const data = await gql(
    key(ctx),
    `query($id: String!) { attachment(id: $id) { id issue { id identifier labels { nodes { id name } } } } }`,
    { id: attachmentId },
  );
  const issue = (data.attachment as Record<string, unknown> | null)?.issue;
  if (!issue || !issueHasScope(ctx, issue))
    throw new Error(
      "Linear attachment is not available to this scoped connection",
    );
}

export function forbidScopeLabelRemoval(ctx: Ctx, labelIds: unknown): void {
  const scoped = new Set(scopeLabelIds(ctx));
  if (scoped.size === 0) return;
  const ids = Array.isArray(labelIds)
    ? labelIds.map(String)
    : [String(labelIds)];
  if (ids.some((id) => scoped.has(id))) {
    throw new Error("Cannot remove a required Linear scope label");
  }
}

export function ensureScopeLabelsOnCreateOrReplace(
  ctx: Ctx,
  labelIds: unknown,
): unknown {
  const scoped = scopeLabelIds(ctx);
  if (scoped.length === 0) return labelIds;
  const ids = new Set(Array.isArray(labelIds) ? labelIds.map(String) : []);
  for (const id of scoped) ids.add(id);
  return [...ids];
}

export function requireUnscoped(ctx: Ctx, action: string): void {
  if (isScoped(ctx)) {
    throw new Error(`${action} is not available to scoped Linear connections`);
  }
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

export function buildConnArgs(
  opts: ListOpts,
  filterTypeName: string | null,
): {
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
  limit: t.Optional(
    t.Number({ description: "Max results (default 50, max 250)" }),
  ),
  filter: t.Optional(
    t.Object(
      {},
      { description: "Linear filter object (see schema for the resource)" },
    ),
  ),
  includeArchived: t.Optional(
    t.Boolean({ description: "Include archived items" }),
  ),
  orderBy: t.Optional(t.String({ description: "createdAt | updatedAt" })),
  after: t.Optional(t.String({ description: "Cursor for forward pagination" })),
  before: t.Optional(
    t.String({ description: "Cursor for backward pagination" }),
  ),
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

const SCOPED_BLOCKED_ROOT_FIELDS = new Set([
  "attachments",
  "comments",
  "customView",
  "customViews",
  "cycle",
  "cycles",
  "initiative",
  "initiatives",
  "project",
  "projects",
  "projectMilestone",
  "projectMilestones",
  "projectUpdates",
  "user",
  "users",
  "webhook",
  "webhooks",
]);

function requireRootFieldAvailable(
  ctx: Ctx,
  action: string,
  rootField: string,
): void {
  if (SCOPED_BLOCKED_ROOT_FIELDS.has(rootField)) requireUnscoped(ctx, action);
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
    inputSchema: t.Object(LIST_INPUT_SCHEMA),
    async execute(input, ctx) {
      requireRootFieldAvailable(ctx, name, rootField);
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
    inputSchema: t.Object({
      id: t.String({ description: "Identifier or slug" }),
    }),
    async execute(input, ctx) {
      requireRootFieldAvailable(ctx, name, rootField);
      const data = await gql(
        key(ctx),
        `query($id: String!) { ${rootField}(id: $id) { ${selection} } }`,
        { id: (input as { id: string }).id },
      );
      return data[rootField];
    },
  });
}
