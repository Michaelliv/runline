import * as t from "typebox";

export type Ctx = { connection: { config: Record<string, unknown> } };

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
  "triage",
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;
export const ISSUE_KIND = [
  "bug",
  "support",
  "feature_request",
  "incident",
  "task",
] as const;
export const ISSUE_PRIORITY = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export const ISSUE_SEVERITY = ["info", "warning", "error", "critical"] as const;
export const ISSUE_SOURCE = [
  "user",
  "agent",
  "system",
  "api",
  "integration",
] as const;
export const PAGE_STATUS = ["draft", "published", "archived"] as const;
export const PAGE_VISIBILITY = ["org", "invited"] as const;

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
