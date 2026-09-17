import { createHash } from "node:crypto";
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { authedFetch } from "../../_shared/authedFetch.js";

const GQL_URL = "https://api.linear.app/graphql";

export type Ctx = { connection: { config: Record<string, unknown> } };

export async function gql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;
  const res = await authedFetch(GQL_URL, {
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

/**
 * The configured scope values, verbatim. Each is either a label UUID or a
 * label name — `resolveScopeLabelIds` turns the latter into the former.
 */
export function scopeLabelValues(ctx: Ctx): string[] {
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One label in the workspace directory. `teamKey` is null for a workspace label. */
interface LabelEntry {
  id: string;
  name: string;
  teamKey: string | null;
}

/** Lowercased name → every label carrying it. Names are not unique. */
type LabelDirectory = Map<string, LabelEntry[]>;

/**
 * The workspace's labels, per API key. Linear rejects a non-UUID in
 * `labels: { id: { in: [...] } }` with "each value in in must be a UUID",
 * so a human-written scope value like `requester:yosi` breaks every issue
 * query (SHFT-1644) unless it is resolved to an id first. The directory is
 * fetched once per key and re-read on a miss, so a label created later
 * still resolves.
 *
 * Keyed by digest, so a long-lived Map never holds the API key itself.
 */
const labelDirectories = new Map<string, Promise<LabelDirectory>>();

const directoryKey = (apiKey: string): string =>
  createHash("sha256").update(apiKey).digest("hex");

async function fetchLabelDirectory(apiKey: string): Promise<LabelDirectory> {
  const byName: LabelDirectory = new Map();
  let after: string | null = null;
  for (;;) {
    const data: Record<string, unknown> = await gql(
      apiKey,
      `query($after: String) { issueLabels(first: 250, after: $after) { nodes { id name team { key } } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    const conn = data.issueLabels as Record<string, unknown> | undefined;
    for (const node of (conn?.nodes as Array<Record<string, unknown>>) ?? []) {
      const name = String(node.name);
      const team = node.team as Record<string, unknown> | null | undefined;
      const entry: LabelEntry = {
        id: String(node.id),
        name,
        teamKey: typeof team?.key === "string" ? team.key : null,
      };
      const lookup = name.toLowerCase();
      const existing = byName.get(lookup);
      if (existing) existing.push(entry);
      else byName.set(lookup, [entry]);
    }
    const pageInfo = conn?.pageInfo as Record<string, unknown> | undefined;
    if (!pageInfo?.hasNextPage) break;
    const next = String(pageInfo.endCursor);
    // A cursor that does not advance would page forever; stop instead.
    if (next === after) break;
    after = next;
  }
  return byName;
}

function labelDirectory(
  apiKey: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<LabelDirectory> {
  const cacheKey = directoryKey(apiKey);
  const cached = refresh ? undefined : labelDirectories.get(cacheKey);
  if (cached) return cached;
  const pending = fetchLabelDirectory(apiKey);
  labelDirectories.set(cacheKey, pending);
  // A failed lookup must not be cached as the answer for this key.
  pending.catch(() => {
    if (labelDirectories.get(cacheKey) === pending)
      labelDirectories.delete(cacheKey);
  });
  return pending;
}

function unknownLabelError(value: string): Error {
  return new Error(
    `Linear scope label "${value}" is neither a label UUID nor the name of a label in this workspace. ` +
      `Set scopeLabelIds (LINEAR_SCOPE_LABEL_IDS) to label UUIDs or exact label names, or unset it for full access.`,
  );
}

/**
 * Label names are not unique in Linear: every team may own a `bug` alongside
 * a workspace one, and a case-insensitive match widens that further. Picking
 * whichever paginated last would scope the connection to a label nobody
 * chose — and a scope that silently binds to the wrong label shows the agent
 * issues it was never meant to read. An ambiguous name is refused instead,
 * with the candidates to choose between.
 */
function ambiguousLabelError(value: string, matches: LabelEntry[]): Error {
  const candidates = matches
    .map(
      (m) =>
        `${m.teamKey ? `team ${m.teamKey}` : "workspace"} "${m.name}" → ${m.id}`,
    )
    .join("; ");
  return new Error(
    `Linear scope label "${value}" is ambiguous: ${matches.length} labels share that name (${candidates}). ` +
      `Set scopeLabelIds (LINEAR_SCOPE_LABEL_IDS) to the UUID of the one you mean.`,
  );
}

/** Scope label UUIDs, resolving any configured label *names* to their ids. */
export async function resolveScopeLabelIds(ctx: Ctx): Promise<string[]> {
  const values = scopeLabelValues(ctx);
  if (values.length === 0) return [];
  if (values.every((v) => UUID_RE.test(v))) return values;

  const apiKey = key(ctx);
  const missing = (directory: LabelDirectory) =>
    values.some((v) => !UUID_RE.test(v) && !directory.has(v.toLowerCase()));
  let directory = await labelDirectory(apiKey);
  // A label created after the directory was cached would otherwise stay
  // unresolvable for the lifetime of the process: re-read once before
  // declaring a name unknown.
  if (missing(directory))
    directory = await labelDirectory(apiKey, { refresh: true });

  return values.map((value) => {
    if (UUID_RE.test(value)) return value;
    const matches = directory.get(value.toLowerCase()) ?? [];
    if (matches.length === 0) throw unknownLabelError(value);
    if (matches.length > 1) throw ambiguousLabelError(value, matches);
    return matches[0].id;
  });
}

export function isScoped(ctx: Ctx): boolean {
  return scopeLabelValues(ctx).length > 0;
}

export async function mergeIssueScopeFilter(
  ctx: Ctx,
  filter?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const ids = await resolveScopeLabelIds(ctx);
  if (ids.length === 0) return filter;
  const scopeFilter = { labels: { id: { in: ids } } };
  if (!filter || Object.keys(filter).length === 0) return scopeFilter;
  return { and: [filter, scopeFilter] };
}

export async function issueHasScope(
  ctx: Ctx,
  issue: unknown,
): Promise<boolean> {
  const ids = new Set(await resolveScopeLabelIds(ctx));
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
  if (!issue || !(await issueHasScope(ctx, issue)))
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
  if (!issue || !(await issueHasScope(ctx, issue)))
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
  if (!issue || !(await issueHasScope(ctx, issue)))
    throw new Error(
      "Linear attachment is not available to this scoped connection",
    );
}

export async function forbidScopeLabelRemoval(
  ctx: Ctx,
  labelIds: unknown,
): Promise<void> {
  const scoped = new Set(await resolveScopeLabelIds(ctx));
  if (scoped.size === 0) return;
  const ids = Array.isArray(labelIds)
    ? labelIds.map(String)
    : [String(labelIds)];
  if (ids.some((id) => scoped.has(id))) {
    throw new Error("Cannot remove a required Linear scope label");
  }
}

export async function ensureScopeLabelsOnCreateOrReplace(
  ctx: Ctx,
  labelIds: unknown,
): Promise<unknown> {
  const scoped = await resolveScopeLabelIds(ctx);
  if (scoped.length === 0) return labelIds;
  const ids = new Set(Array.isArray(labelIds) ? labelIds.map(String) : []);
  for (const id of scoped) ids.add(id);
  return [...ids];
}

/**
 * Appended to the description of every action a scoped connection cannot
 * use. Descriptions are static, but they are also all an agent sees when it
 * picks an action (`actions.find`, the Vex catalog): without this, a scoped
 * agent discovers the action, calls it, and only then learns it is blocked.
 */
export const SCOPED_UNAVAILABLE_NOTE = "Unavailable on scoped connections.";

export function withScopedNote(description: string): string {
  return `${description} ${SCOPED_UNAVAILABLE_NOTE}`;
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
export const ISSUE_LITE = `id identifier title url priority state { id name type } assignee { id name } team { key } cycle { id number name } updatedAt`;
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
    t.Number({
      description:
        "Max results per page (default 50, max 250). For more, paginate with `after` = pageInfo.endCursor",
    }),
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

/**
 * Root fields a scoped connection may not read.
 *
 * The scope restricts *issue content*, so workspace metadata an agent needs
 * to route and report on its own issues — cycles, users, teams, states and
 * labels — stays readable. Fields that would leak other people's content or
 * secrets are blocked, and a blocked field's description says so.
 */
const SCOPED_BLOCKED_ROOT_FIELDS = new Set([
  "attachments",
  "comments",
  "customView",
  "customViews",
  "initiative",
  "initiatives",
  "project",
  "projects",
  "projectMilestone",
  "projectMilestones",
  "projectUpdates",
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
    access: "read",
    description: SCOPED_BLOCKED_ROOT_FIELDS.has(rootField)
      ? withScopedNote(description)
      : description,
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
    access: "read",
    description: SCOPED_BLOCKED_ROOT_FIELDS.has(rootField)
      ? withScopedNote(description)
      : description,
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
