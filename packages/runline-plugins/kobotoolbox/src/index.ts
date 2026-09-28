import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  pathWithin,
} from "../../_shared/credentials.js";
import { kobotoolboxCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, kobotoolboxCredential, "kobotoolbox", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 3000;
  let path: string | undefined = endpoint;
  let query: Record<string, unknown> | undefined = qs;
  while (path) {
    const data = (await apiRequest(ctx, "GET", path, undefined, query)) as
      | Record<string, unknown>
      | unknown[];
    query = undefined;
    if (!Array.isArray(data) && data.results && Array.isArray(data.results)) {
      all.push(...(data.results as unknown[]));
      const next = data.next as string | null | undefined;
      // A next-page link stays beneath the connection's own API base.
      path = next
        ? pathWithin(ctx, kobotoolboxCredential, "api", next)
        : undefined;
    } else {
      // Non-paginated response
      return Array.isArray(data) ? data : [data];
    }
  }
  return all;
}

export default function kobotoolbox(rl: RunlinePluginAPI) {
  rl.setName("kobotoolbox");
  rl.setVersion("0.1.0");
  rl.setCredential(kobotoolboxCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "KoBoToolbox server URL (e.g. https://kf.kobotoolbox.org)",
      env: "KOBOTOOLBOX_URL",
    },
    token: {
      type: "string",
      required: true,
      description: "API token",
      env: "KOBOTOOLBOX_TOKEN",
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.get", {
    access: "read",
    description: "Get a form (asset) by ID",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form/asset UID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment((input as { formId: string }).formId)}`,
      );
    },
  });

  rl.registerAction("form.list", {
    access: "read",
    description: "List all forms/assets",
    inputSchema: {
      limit: { type: "number", required: false },
      filter: {
        type: "string",
        required: false,
        description: "Search query (q parameter)",
      },
      ordering: {
        type: "string",
        required: false,
        description: "Field to sort by",
      },
      descending: {
        type: "boolean",
        required: false,
        description: "Sort descending",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.filter) qs.q = p.filter;
      if (p.ordering) qs.ordering = (p.descending ? "-" : "") + p.ordering;
      if (p.limit) {
        qs.limit = p.limit;
        return apiRequest(ctx, "GET", "assets/", undefined, qs);
      }
      return paginate(ctx, "assets/", qs);
    },
  });

  rl.registerAction("form.redeploy", {
    access: "write",
    description: "Redeploy a form",
    inputSchema: { formId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "PATCH",
        `assets/${pathSegment((input as { formId: string }).formId)}/deployment/`,
      );
    },
  });

  // ── Submission ──────────────────────────────────────

  rl.registerAction("submission.get", {
    access: "read",
    description: "Get a submission by ID",
    inputSchema: {
      formId: { type: "string", required: true },
      submissionId: { type: "string", required: true },
      fields: {
        type: "array",
        required: false,
        description: "Fields to include",
      },
    },
    async execute(input, ctx) {
      const { formId, submissionId, fields } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields && Array.isArray(fields)) qs.fields = JSON.stringify(fields);
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment(formId)}/data/${pathSegment(submissionId)}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("submission.list", {
    access: "read",
    description: "List submissions for a form",
    inputSchema: {
      formId: { type: "string", required: true },
      limit: { type: "number", required: false },
      query: {
        type: "string",
        required: false,
        description: "JSON filter query",
      },
      sort: { type: "string", required: false, description: "Sort JSON" },
      fields: {
        type: "array",
        required: false,
        description: "Fields to include",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.sort) qs.sort = p.sort;
      if (p.fields && Array.isArray(p.fields))
        qs.fields = JSON.stringify(p.fields);
      if (p.limit) {
        qs.limit = p.limit;
        const data = (await apiRequest(
          ctx,
          "GET",
          `assets/${pathSegment(p.formId)}/data/`,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.results ?? data;
      }
      return paginate(ctx, `assets/${pathSegment(p.formId)}/data/`, qs);
    },
  });

  rl.registerAction("submission.delete", {
    access: "write",
    description: "Delete a submission",
    inputSchema: {
      formId: { type: "string", required: true },
      submissionId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, submissionId } = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `assets/${pathSegment(formId)}/data/${pathSegment(submissionId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("submission.getValidation", {
    access: "read",
    description: "Get the validation status of a submission",
    inputSchema: {
      formId: { type: "string", required: true },
      submissionId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, submissionId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment(formId)}/data/${pathSegment(submissionId)}/validation_status/`,
      );
    },
  });

  rl.registerAction("submission.setValidation", {
    access: "write",
    description: "Set the validation status of a submission",
    inputSchema: {
      formId: { type: "string", required: true },
      submissionId: { type: "string", required: true },
      validationStatus: {
        type: "string",
        required: true,
        description:
          "validation_status_not_approved, validation_status_approved, validation_status_on_hold",
      },
    },
    async execute(input, ctx) {
      const { formId, submissionId, validationStatus } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        ctx,
        "PATCH",
        `assets/${pathSegment(formId)}/data/${pathSegment(submissionId)}/validation_status/`,
        { "validation_status.uid": validationStatus },
      );
    },
  });

  // ── Hook ────────────────────────────────────────────

  rl.registerAction("hook.get", {
    access: "read",
    description: "Get a hook by ID",
    inputSchema: {
      formId: { type: "string", required: true },
      hookId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, hookId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment(formId)}/hooks/${pathSegment(hookId)}`,
      );
    },
  });

  rl.registerAction("hook.list", {
    access: "read",
    description: "List hooks for a form",
    inputSchema: {
      formId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { formId, limit } = input as Record<string, unknown>;
      if (limit)
        return apiRequest(
          ctx,
          "GET",
          `assets/${pathSegment(formId)}/hooks/`,
          undefined,
          { limit },
        );
      return paginate(ctx, `assets/${pathSegment(formId)}/hooks/`);
    },
  });

  rl.registerAction("hook.retryAll", {
    access: "write",
    description: "Retry all failed attempts for a hook",
    inputSchema: {
      formId: { type: "string", required: true },
      hookId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, hookId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PATCH",
        `assets/${pathSegment(formId)}/hooks/${pathSegment(hookId)}/retry/`,
      );
    },
  });

  rl.registerAction("hook.getLogs", {
    access: "read",
    description: "Get logs for a hook",
    inputSchema: {
      formId: { type: "string", required: true },
      hookId: { type: "string", required: true },
      startDate: {
        type: "string",
        required: false,
        description: "Start date filter",
      },
      endDate: {
        type: "string",
        required: false,
        description: "End date filter",
      },
      status: {
        type: "number",
        required: false,
        description: "HTTP status code filter",
      },
    },
    async execute(input, ctx) {
      const { formId, hookId, startDate, endDate, status } = input as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (startDate) qs.start = startDate;
      if (endDate) qs.end = endDate;
      if (status) qs.status = status;
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment(formId)}/hooks/${pathSegment(hookId)}/logs/`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("hook.retryOne", {
    access: "write",
    description: "Retry a single failed hook log entry",
    inputSchema: {
      formId: { type: "string", required: true },
      hookId: { type: "string", required: true },
      logId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, hookId, logId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PATCH",
        `assets/${pathSegment(formId)}/hooks/${pathSegment(hookId)}/logs/${pathSegment(logId)}/retry/`,
      );
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.list", {
    access: "read",
    description: "List media files for a form",
    inputSchema: { formId: { type: "string", required: true } },
    async execute(input, ctx) {
      return paginate(
        ctx,
        `assets/${pathSegment((input as { formId: string }).formId)}/files`,
        { file_type: "form_media" },
      );
    },
  });

  rl.registerAction("file.get", {
    access: "read",
    description: "Get a file's metadata",
    inputSchema: {
      formId: { type: "string", required: true },
      fileId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, fileId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `assets/${pathSegment(formId)}/files/${pathSegment(fileId)}`,
      );
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: {
      formId: { type: "string", required: true },
      fileId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { formId, fileId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `assets/${pathSegment(formId)}/files/${pathSegment(fileId)}`,
      );
    },
  });

  rl.registerAction("file.createFromUrl", {
    access: "write",
    description: "Create a file from a URL (redirect-based media)",
    inputSchema: {
      formId: { type: "string", required: true },
      redirectUrl: {
        type: "string",
        required: true,
        description: "URL of the file",
      },
    },
    async execute(input, ctx) {
      const { formId, redirectUrl } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `assets/${pathSegment(formId)}/files/`, {
        description: "Uploaded file",
        file_type: "form_media",
        metadata: { redirect_url: redirectUrl },
      });
    },
  });
}
