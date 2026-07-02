import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`KoBoToolbox API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

async function paginate(
  baseUrl: string,
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 3000;
  let nextUrl: string | null = `${baseUrl}${endpoint}`;
  const initialUrl = new URL(nextUrl);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null)
      initialUrl.searchParams.set(k, String(v));
  }
  nextUrl = initialUrl.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json" },
    });
    if (!res.ok)
      throw new Error(
        `KoBoToolbox API error ${res.status}: ${await res.text()}`,
      );
    const data = (await res.json()) as Record<string, unknown>;
    if (data.results && Array.isArray(data.results)) {
      all.push(...(data.results as unknown[]));
      nextUrl = (data.next as string) ?? null;
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

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    baseUrl: (ctx.connection.config.url as string).replace(/\/$/, ""),
    token: ctx.connection.config.token as string,
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.get", {
    access: "read",
    description: "Get a form (asset) by ID",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form/asset UID" },
    },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${(input as { formId: string }).formId}`,
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
      const { baseUrl, token } = conn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.filter) qs.q = p.filter;
      if (p.ordering) qs.ordering = (p.descending ? "-" : "") + p.ordering;
      if (p.limit) {
        qs.limit = p.limit;
        return apiRequest(
          baseUrl,
          token,
          "GET",
          "/api/v2/assets/",
          undefined,
          qs,
        );
      }
      return paginate(baseUrl, token, "/api/v2/assets/", qs);
    },
  });

  rl.registerAction("form.redeploy", {
    access: "write",
    description: "Redeploy a form",
    inputSchema: { formId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "PATCH",
        `/api/v2/assets/${(input as { formId: string }).formId}/deployment/`,
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
      const { baseUrl, token } = conn(ctx);
      const qs: Record<string, unknown> = {};
      if (fields && Array.isArray(fields)) qs.fields = JSON.stringify(fields);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${formId}/data/${submissionId}`,
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
      const { baseUrl, token } = conn(ctx);
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.sort) qs.sort = p.sort;
      if (p.fields && Array.isArray(p.fields))
        qs.fields = JSON.stringify(p.fields);
      if (p.limit) {
        qs.limit = p.limit;
        const data = (await apiRequest(
          baseUrl,
          token,
          "GET",
          `/api/v2/assets/${p.formId}/data/`,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.results ?? data;
      }
      return paginate(baseUrl, token, `/api/v2/assets/${p.formId}/data/`, qs);
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
      const { baseUrl, token } = conn(ctx);
      await apiRequest(
        baseUrl,
        token,
        "DELETE",
        `/api/v2/assets/${formId}/data/${submissionId}`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${formId}/data/${submissionId}/validation_status/`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "PATCH",
        `/api/v2/assets/${formId}/data/${submissionId}/validation_status/`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${formId}/hooks/${hookId}`,
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
      const { baseUrl, token } = conn(ctx);
      if (limit)
        return apiRequest(
          baseUrl,
          token,
          "GET",
          `/api/v2/assets/${formId}/hooks/`,
          undefined,
          { limit },
        );
      return paginate(baseUrl, token, `/api/v2/assets/${formId}/hooks/`);
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "PATCH",
        `/api/v2/assets/${formId}/hooks/${hookId}/retry/`,
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
      const { baseUrl, token } = conn(ctx);
      const qs: Record<string, unknown> = {};
      if (startDate) qs.start = startDate;
      if (endDate) qs.end = endDate;
      if (status) qs.status = status;
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${formId}/hooks/${hookId}/logs/`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "PATCH",
        `/api/v2/assets/${formId}/hooks/${hookId}/logs/${logId}/retry/`,
      );
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.list", {
    access: "read",
    description: "List media files for a form",
    inputSchema: { formId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return paginate(
        baseUrl,
        token,
        `/api/v2/assets/${(input as { formId: string }).formId}/files`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/v2/assets/${formId}/files/${fileId}`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "DELETE",
        `/api/v2/assets/${formId}/files/${fileId}`,
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
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "POST",
        `/api/v2/assets/${formId}/files/`,
        {
          description: "Uploaded file",
          file_type: "form_media",
          metadata: { redirect_url: redirectUrl },
        },
      );
    },
  });
}
