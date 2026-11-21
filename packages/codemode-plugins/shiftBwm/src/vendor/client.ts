/**
 * SYNCED_FROM shift-labs-ai/cloud@42c9f13
 *   packages/business-world-model-service/src/client.ts
 *
 * Verbatim copy; only the import paths and the route-prefix constant are
 * rewritten. Do not edit here.
 */
/**
 * Browser-safe HTTP client for the Business World Model API. Talks the
 * same envelope the controller serves; the server derives the organization
 * from the caller's principal.
 */
import { BWM_OBJECT_TYPE_PATHS, BWM_ROUTE_PREFIX } from "./contracts.js";
import { z } from "zod";
import {
  type BwmChangeEvent,
  type BwmCreateFieldInput,
  type BwmCreateGroupInput,
  type BwmCreateListInput,
  type BwmCreateObjectTypeInput,
  type BwmCreatePipelineInput,
  type BwmCreateRecordInput,
  type BwmCreateRelationshipDefinitionInput,
  BwmDefinitions,
  BwmFieldDefinition,
  BwmFieldHistory,
  BwmFile,
  BwmFileUpload,
  type BwmFileUploadInput,
  BwmFileUrl,
  type BwmFilter,
  BwmGroup,
  type BwmGroupMembersInput,
  type BwmLinkDirection,
  BwmLinks,
  BwmList,
  BwmMemberPage,
  BwmMerge,
  type BwmMergeInput,
  BwmMergeResult,
  BwmObjectType,
  BwmPipeline,
  BwmRecord,
  BwmRecordPage,
  BwmRelationshipDefinition,
  type BwmUpdateGroupInput,
  type BwmUpdateListInput,
  type BwmUpdateRecordInput,
} from "./models.js";

export type BwmFetch = (
  input: string,
  init?: { method?: string; headers?: Headers; body?: string },
) => Promise<Response>;

export interface BwmClientOptions {
  baseUrl: string;
  fetch?: BwmFetch;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
}

export interface BwmListOptions {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
  filters?: BwmFilter[];
}

/**
 * A failed request. `type` is the coarse kind (`not_found`, …); `code` is
 * the finer service code when the server sent one, else the type; `param`
 * names the offending request location (`fields.$name`).
 */
export class BwmClientError extends Error {
  readonly type: string;
  readonly code: string;
  readonly param?: string;

  constructor(
    readonly status: number,
    error: { type: string; message: string; code?: string; param?: string },
    readonly body: unknown,
  ) {
    super(error.message);
    this.name = "BwmClientError";
    this.type = error.type;
    this.code = error.code ?? error.type;
    this.param = error.param;
  }
}

/** URL segment for an object type: built-in path or `objects/{slug}`. */
export function objectTypePath(objectType: string): string {
  return (
    (BWM_OBJECT_TYPE_PATHS as Record<string, string>)[objectType] ??
    `objects/${objectType}`
  );
}

export class BusinessWorldModelClient {
  private readonly prefix: string;
  private readonly fetchImpl: BwmFetch;

  constructor(private readonly options: BwmClientOptions) {
    this.prefix = `${options.baseUrl.replace(/\/$/, "")}${BWM_ROUTE_PREFIX}`;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  listObjectTypes() {
    return this.get(
      "/object-types",
      z.object({ objectTypes: z.array(BwmObjectType) }),
    ).then((r) => r.objectTypes);
  }
  createObjectType(input: BwmCreateObjectTypeInput) {
    return this.send(
      "POST",
      "/object-types",
      input,
      z.object({ objectType: BwmObjectType }),
    ).then((r) => r.objectType);
  }
  getDefinitions(objectType: string) {
    return this.get(
      `/${objectTypePath(objectType)}/definitions`,
      BwmDefinitions,
    );
  }
  createField(objectType: string, input: BwmCreateFieldInput) {
    return this.send(
      "POST",
      `/${objectTypePath(objectType)}/fields`,
      input,
      z.object({ field: BwmFieldDefinition }),
    ).then((r) => r.field);
  }
  createRelationshipDefinition(
    objectType: string,
    input: BwmCreateRelationshipDefinitionInput,
  ) {
    return this.send(
      "POST",
      `/${objectTypePath(objectType)}/relationships`,
      input,
      z.object({ relationship: BwmRelationshipDefinition }),
    ).then((r) => r.relationship);
  }
  listPipelines() {
    return this.get(
      "/pipelines",
      z.object({ pipelines: z.array(BwmPipeline) }),
    ).then((r) => r.pipelines);
  }
  createPipeline(input: BwmCreatePipelineInput) {
    return this.send(
      "POST",
      "/pipelines",
      input,
      z.object({ pipeline: BwmPipeline }),
    ).then((r) => r.pipeline);
  }

  listRecords(objectType: string, options: BwmListOptions = {}) {
    return this.get(
      `/${objectTypePath(objectType)}${listSearch(options)}`,
      BwmRecordPage,
    );
  }
  getRecord(objectType: string, id: string) {
    return this.get(
      `/${objectTypePath(objectType)}/${encodeURIComponent(id)}`,
      BwmRecord,
    );
  }
  createRecord(objectType: string, input: BwmCreateRecordInput) {
    return this.send(
      "POST",
      `/${objectTypePath(objectType)}`,
      input,
      BwmRecord,
    );
  }
  updateRecord(objectType: string, id: string, input: BwmUpdateRecordInput) {
    return this.send(
      "PATCH",
      `/${objectTypePath(objectType)}/${encodeURIComponent(id)}`,
      input,
      BwmRecord,
    );
  }
  archiveRecord(objectType: string, id: string) {
    return this.send(
      "DELETE",
      `/${objectTypePath(objectType)}/${encodeURIComponent(id)}`,
      undefined,
      BwmRecord,
    );
  }
  getFieldHistory(
    objectType: string,
    id: string,
    fieldKey: string,
    query: { limit?: number; after?: string } = {},
  ) {
    const search = new URLSearchParams();
    if (query.limit) search.set("limit", String(query.limit));
    if (query.after) search.set("after", query.after);
    const suffix = search.size ? `?${search}` : "";
    return this.get(
      `/${objectTypePath(objectType)}/${encodeURIComponent(id)}/fields/${encodeURIComponent(fieldKey)}/history${suffix}`,
      BwmFieldHistory,
    );
  }
  mergeRecords(objectType: string, input: BwmMergeInput) {
    return this.send(
      "POST",
      `/${objectTypePath(objectType)}/merge`,
      input,
      BwmMergeResult,
    );
  }
  getMerge(id: string) {
    return this.get(`/merges/${encodeURIComponent(id)}`, BwmMerge);
  }
  listLinks(id: string, direction: BwmLinkDirection = "both") {
    return this.get(
      `/records/${encodeURIComponent(id)}/links?direction=${direction}`,
      BwmLinks,
    );
  }
  listChangeEvents(id: string) {
    return this.get(
      `/records/${encodeURIComponent(id)}/change-events`,
      z.object({ changeEvents: z.array(z.custom<BwmChangeEvent>()) }),
    ).then((r) => r.changeEvents);
  }

  listLists() {
    return this.get("/lists", z.object({ lists: z.array(BwmList) })).then(
      (r) => r.lists,
    );
  }
  getList(id: string) {
    return this.get(`/lists/${encodeURIComponent(id)}`, BwmList);
  }
  createList(input: BwmCreateListInput) {
    return this.send("POST", "/lists", input, BwmList);
  }
  updateList(id: string, input: BwmUpdateListInput) {
    return this.send(
      "PATCH",
      `/lists/${encodeURIComponent(id)}`,
      input,
      BwmList,
    );
  }
  listListRecords(id: string, options: BwmListOptions = {}) {
    return this.get(
      `/lists/${encodeURIComponent(id)}/records${listSearch(options)}`,
      BwmRecordPage,
    );
  }

  listGroups() {
    return this.get("/groups", z.object({ groups: z.array(BwmGroup) })).then(
      (r) => r.groups,
    );
  }
  createGroup(input: BwmCreateGroupInput) {
    return this.send(
      "POST",
      "/groups",
      input,
      z.object({ group: BwmGroup }),
    ).then((r) => r.group);
  }
  updateGroup(id: string, input: BwmUpdateGroupInput) {
    return this.send(
      "PATCH",
      `/groups/${encodeURIComponent(id)}`,
      input,
      z.object({ group: BwmGroup }),
    ).then((r) => r.group);
  }
  updateGroupMembers(id: string, input: BwmGroupMembersInput) {
    return this.send(
      "POST",
      `/groups/${encodeURIComponent(id)}/members`,
      input,
      z.object({ group: BwmGroup }),
    ).then((r) => r.group);
  }
  deleteGroup(id: string) {
    return this.send(
      "DELETE",
      `/groups/${encodeURIComponent(id)}`,
      undefined,
      z.undefined(),
    );
  }

  listMembers(query: { limit?: number; offset?: number } = {}) {
    const search = new URLSearchParams();
    if (query.limit) search.set("limit", String(query.limit));
    if (query.offset) search.set("offset", String(query.offset));
    return this.get(
      `/members${search.size ? `?${search}` : ""}`,
      BwmMemberPage,
    );
  }

  createFileUpload(input: BwmFileUploadInput) {
    return this.send("POST", "/files", input, BwmFileUpload);
  }
  completeFileUpload(id: string) {
    return this.send(
      "POST",
      `/files/${encodeURIComponent(id)}/complete`,
      undefined,
      BwmFile,
    );
  }
  getRecordFileUrl(recordId: string, fileId: string) {
    return this.get(
      `/records/${encodeURIComponent(recordId)}/files/${encodeURIComponent(fileId)}/url`,
      BwmFileUrl,
    );
  }

  private get<T>(path: string, schema: z.ZodType<T>) {
    return this.send("GET", path, undefined, schema);
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const extra =
      typeof this.options.headers === "function"
        ? await this.options.headers()
        : (this.options.headers ?? {});
    const headers = new Headers(extra);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`${this.prefix}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return schema.parse(undefined);
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON error bodies are reported verbatim.
    }
    if (!response.ok) {
      throw new BwmClientError(
        response.status,
        errorOf(payload, response),
        payload,
      );
    }
    return schema.parse(payload);
  }
}

function errorOf(
  payload: unknown,
  response: Response,
): { type: string; message: string; code?: string; param?: string } {
  const fallback = {
    type:
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : "error",
    message:
      typeof payload === "string" && payload
        ? payload
        : response.statusText || `HTTP ${response.status}`,
  };
  if (!payload || typeof payload !== "object" || !("error" in payload))
    return fallback;
  const error = (payload as { error: unknown }).error;
  if (typeof error === "string")
    return { ...fallback, message: error, code: error };
  if (!error || typeof error !== "object") return fallback;
  const shaped = error as {
    type?: unknown;
    message?: unknown;
    code?: unknown;
    param?: unknown;
  };
  return {
    type: typeof shaped.type === "string" ? shaped.type : fallback.type,
    message:
      typeof shaped.message === "string" ? shaped.message : fallback.message,
    code: typeof shaped.code === "string" ? shaped.code : undefined,
    param: typeof shaped.param === "string" ? shaped.param : undefined,
  };
}

function listSearch(options: BwmListOptions): string {
  const search = new URLSearchParams();
  if (options.limit) search.set("limit", String(options.limit));
  if (options.offset) search.set("offset", String(options.offset));
  if (options.includeArchived) search.set("includeArchived", "true");
  for (const filter of options.filters ?? []) {
    const operator = filter.operator
      ? `[${filter.negate ? "-" : ""}${filter.operator}]`
      : "";
    search.append(`${filter.key}${operator}`, filter.value);
  }
  return search.size ? `?${search}` : "";
}
