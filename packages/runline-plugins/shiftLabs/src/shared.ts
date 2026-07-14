import * as t from "typebox";

export type Ctx = { connection: { config: Record<string, unknown> } };

export const STRICT_OBJECT = { additionalProperties: false } as const;
export const STRICT_UPDATE_OBJECT = {
  additionalProperties: false,
  minProperties: 2,
} as const;

export function idSchema(description: string) {
  return t.String({ minLength: 1, pattern: "\\S", description });
}

export function cursorSchema(description = "Next-page cursor") {
  return t.String({ minLength: 1, maxLength: 512, description });
}

export function timestampSchema(description: string) {
  return t.String({
    format: "date-time",
    pattern: "Z$",
    description,
  });
}

export type ShiftIssueActorType = "user" | "service" | "agent" | "system";

export interface ShiftProject {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: (typeof PROJECT_STATUS)[number];
  leadUserId?: string;
  startAt?: string;
  targetAt?: string;
  createdByType: ShiftIssueActorType;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archivedAt?: string;
}

export interface ShiftProjectProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface ShiftIssue {
  id: string;
  organizationId: string;
  number: number;
  title: string;
  description: string;
  projectId?: string;
  parentIssueId?: string;
  sortOrder: number;
  status: (typeof ISSUE_STATUS)[number];
  priority: (typeof ISSUE_PRIORITY)[number];
  source: (typeof ISSUE_SOURCE)[number];
  reporterType: ShiftIssueActorType;
  reporterId?: string;
  assigneeUserId?: string;
  startAt?: string;
  dueAt?: string;
  deploymentId?: string;
  workspaceId?: string;
  sessionId?: string;
  traceId?: string;
  fingerprint?: string;
  labels: string[];
  metadata?: Record<string, unknown>;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  completedAt?: string;
  archivedAt?: string;
}

export interface ShiftIssueViewFilters {
  projectId?: string;
  rootIssueId?: string;
  statuses?: Array<(typeof ISSUE_STATUS)[number]>;
  priorities?: Array<(typeof ISSUE_PRIORITY)[number]>;
  assigneeUserIds?: string[];
  labels?: string[];
  startAfter?: string;
  dueBefore?: string;
  blocked?: boolean;
}

export interface ShiftIssueView {
  id: string;
  organizationId: string;
  name: string;
  visibility: (typeof ISSUE_VIEW_VISIBILITY)[number];
  layout: (typeof ISSUE_VIEW_LAYOUT)[number];
  filters: ShiftIssueViewFilters;
  groupBy?: (typeof ISSUE_VIEW_GROUP)[number];
  sortBy: Array<(typeof ISSUE_VIEW_SORT)[number]>;
  createdByType: ShiftIssueActorType;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export type ShiftIssueEventType =
  | "created"
  | "updated"
  | "reported_again"
  | "commented"
  | "status_changed"
  | "assigned"
  | "priority_changed"
  | "labeled"
  | "project_changed"
  | "parent_changed"
  | "dates_changed"
  | "dependency_added"
  | "dependency_removed"
  | "resolved"
  | "reopened"
  | "closed";

export interface ShiftIssueEvent {
  id: string;
  issueId: string;
  organizationId: string;
  actorType: ShiftIssueActorType;
  actorId?: string;
  type: ShiftIssueEventType;
  from?: string;
  to?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ShiftIssueDependency {
  id: string;
  organizationId: string;
  blockingIssueId: string;
  blockedIssueId: string;
  createdByType: ShiftIssueActorType;
  createdById?: string;
  createdAt: string;
}

const SHIFT_LABS_API_URL = "https://d1ood6y5zobtne.cloudfront.net";

export function baseUrl(): string {
  return `${SHIFT_LABS_API_URL}/`;
}

export async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const apiKey = ctx.connection.config.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("Shift Labs apiKey is required");
  }
  headers.set("authorization", `Bearer ${apiKey}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, baseUrl()), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `Shift Labs API error ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function pageRenderUrl(organizationId: string, slug: string): string {
  return new URL(
    `/pages/${pathSegment(organizationId)}/${pathSegment(slug)}`,
    baseUrl(),
  ).toString();
}

export const ISSUE_STATUS = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "canceled",
] as const;
export const PROJECT_STATUS = [
  "planned",
  "active",
  "completed",
  "canceled",
] as const;
export const ISSUE_PRIORITY = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export const ISSUE_SOURCE = [
  "user",
  "agent",
  "system",
  "api",
  "integration",
] as const;
export const ISSUE_VIEW_VISIBILITY = ["personal", "organization"] as const;
export const ISSUE_VIEW_LAYOUT = ["list", "board", "timeline"] as const;
export const ISSUE_VIEW_GROUP = [
  "status",
  "assignee",
  "priority",
  "project",
] as const;
export const ISSUE_VIEW_SORT = [
  "manual",
  "priority",
  "startAt",
  "dueAt",
  "updatedAt",
] as const;
export const PAGE_STATUS = ["draft", "published", "archived"] as const;
export const PAGE_VISIBILITY = ["org", "invited"] as const;
export const TRANSCRIPTION_LANGUAGE = ["auto", "en", "he"] as const;
export const TRANSCRIPT_FORMAT = ["txt", "srt", "vtt", "json"] as const;

export function enumDescription(
  name: string,
  values: readonly string[],
): string {
  return `${name}: ${values.join(" | ")}`;
}

export function enumSchema(name: string, values: readonly string[]) {
  return t.Union(
    values.map((value) => t.Literal(value)) as [
      ReturnType<typeof t.Literal>,
      ReturnType<typeof t.Literal>,
    ],
    { description: enumDescription(name, values) },
  );
}
