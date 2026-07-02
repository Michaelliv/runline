import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.currents.dev/v1";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) {
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(`${k}[]`, String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Currents API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function unwrapData(response: unknown): unknown {
  if (
    response &&
    typeof response === "object" &&
    "data" in (response as Record<string, unknown>)
  ) {
    return (response as Record<string, unknown>).data;
  }
  return response;
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function currents(rl: RunlinePluginAPI) {
  rl.setName("currents");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Currents API key",
      env: "CURRENTS_API_KEY",
    },
  });

  // ── Action ──────────────────────────────────────────

  rl.registerAction("action.create", {
    access: "write",
    description: "Create a new action (skip, quarantine, or tag rule)",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      name: { type: "string", required: true, description: "Action name" },
      actionType: {
        type: "string",
        required: true,
        description: "Type: skip, quarantine, or tag",
      },
      matcherType: {
        type: "string",
        required: true,
        description:
          "Matcher: titleContains, titleEquals, specContains, specEquals, signature",
      },
      matcherValue: {
        type: "string",
        required: true,
        description: "Value to match against",
      },
      tags: {
        type: "array",
        required: false,
        description: "Tags to apply (for tag action type)",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      expiresAfter: {
        type: "string",
        required: false,
        description: "Expiration date (ISO 8601)",
      },
    },
    async execute(input, ctx) {
      const {
        projectId,
        name,
        actionType,
        matcherType,
        matcherValue,
        tags,
        description: desc,
        expiresAfter,
      } = input as Record<string, unknown>;

      const typeMap: Record<string, string> = {
        titleContains: "title",
        titleEquals: "title",
        specContains: "file",
        specEquals: "file",
        signature: "testId",
      };
      const opMap: Record<string, string> = {
        titleContains: "inc",
        titleEquals: "eq",
        specContains: "inc",
        specEquals: "eq",
        signature: "eq",
      };

      const action =
        actionType === "tag" && tags
          ? [{ op: "tag", details: { tags } }]
          : [{ op: actionType }];

      const body: Record<string, unknown> = {
        name,
        action,
        matcher: {
          op: "AND",
          cond: [
            {
              type: typeMap[matcherType as string],
              op: opMap[matcherType as string],
              value: matcherValue,
            },
          ],
        },
      };
      if (desc) body.description = desc;
      if (expiresAfter) body.expiresAfter = expiresAfter;

      return apiRequest(getKey(ctx), "POST", "/actions", body, { projectId });
    },
  });

  rl.registerAction("action.get", {
    access: "read",
    description: "Get an action by ID",
    inputSchema: {
      actionId: { type: "string", required: true, description: "Action ID" },
    },
    async execute(input, ctx) {
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/actions/${(input as { actionId: string }).actionId}`,
        ),
      );
    },
  });

  rl.registerAction("action.list", {
    access: "read",
    description: "List actions for a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      search: {
        type: "string",
        required: false,
        description: "Search by name",
      },
      status: {
        type: "array",
        required: false,
        description: "Filter by status: active, disabled, archived, expired",
      },
    },
    async execute(input, ctx) {
      const { projectId, search, status } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = { projectId };
      if (search) qs.search = search;
      if (status) qs.status = status;
      return unwrapData(
        await apiRequest(getKey(ctx), "GET", "/actions", undefined, qs),
      );
    },
  });

  rl.registerAction("action.update", {
    access: "write",
    description: "Update an action",
    inputSchema: {
      actionId: { type: "string", required: true, description: "Action ID" },
      name: { type: "string", required: false, description: "New name" },
      description: {
        type: "string",
        required: false,
        description: "New description",
      },
      expiresAfter: {
        type: "string",
        required: false,
        description: "Expiration date",
      },
    },
    async execute(input, ctx) {
      const { actionId, ...body } = input as Record<string, unknown>;
      return apiRequest(getKey(ctx), "PUT", `/actions/${actionId}`, body);
    },
  });

  rl.registerAction("action.enable", {
    access: "write",
    description: "Enable a disabled action",
    inputSchema: {
      actionId: { type: "string", required: true, description: "Action ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        getKey(ctx),
        "PUT",
        `/actions/${(input as { actionId: string }).actionId}/enable`,
      );
    },
  });

  rl.registerAction("action.disable", {
    access: "write",
    description: "Disable an active action",
    inputSchema: {
      actionId: { type: "string", required: true, description: "Action ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        getKey(ctx),
        "PUT",
        `/actions/${(input as { actionId: string }).actionId}/disable`,
      );
    },
  });

  rl.registerAction("action.delete", {
    access: "write",
    description: "Archive (soft delete) an action",
    inputSchema: {
      actionId: { type: "string", required: true, description: "Action ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `/actions/${(input as { actionId: string }).actionId}`,
      );
      return { success: true };
    },
  });

  // ── Instance ────────────────────────────────────────

  rl.registerAction("instance.get", {
    access: "read",
    description: "Get a spec file execution instance with full test results",
    inputSchema: {
      instanceId: {
        type: "string",
        required: true,
        description: "Instance ID",
      },
    },
    async execute(input, ctx) {
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/instances/${(input as { instanceId: string }).instanceId}`,
        ),
      );
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project by ID",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        getKey(ctx),
        "GET",
        `/projects/${(input as { projectId: string }).projectId}`,
      );
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List projects",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) qs.limit = limit;
      return unwrapData(
        await apiRequest(getKey(ctx), "GET", "/projects", undefined, qs),
      );
    },
  });

  rl.registerAction("project.getInsights", {
    access: "read",
    description: "Get project insights and metrics",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      dateStart: {
        type: "string",
        required: true,
        description: "Start date (ISO 8601)",
      },
      dateEnd: {
        type: "string",
        required: true,
        description: "End date (ISO 8601)",
      },
      resolution: {
        type: "string",
        required: false,
        description: "Resolution: 1h, 1d (default), 1w",
      },
      branches: {
        type: "array",
        required: false,
        description: "Filter by branches",
      },
      authors: {
        type: "array",
        required: false,
        description: "Filter by authors",
      },
      tags: { type: "array", required: false, description: "Filter by tags" },
    },
    async execute(input, ctx) {
      const {
        projectId,
        dateStart,
        dateEnd,
        resolution,
        branches,
        authors,
        tags,
      } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        date_start: dateStart,
        date_end: dateEnd,
      };
      if (resolution) qs.resolution = resolution;
      if (branches) qs.branches = branches;
      if (authors) qs.authors = authors;
      if (tags) qs.tags = tags;
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/projects/${projectId}/insights`,
          undefined,
          qs,
        ),
      );
    },
  });

  // ── Run ─────────────────────────────────────────────

  rl.registerAction("run.get", {
    access: "read",
    description: "Get a run by ID",
    inputSchema: {
      runId: { type: "string", required: true, description: "Run ID" },
    },
    async execute(input, ctx) {
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/runs/${(input as { runId: string }).runId}`,
        ),
      );
    },
  });

  rl.registerAction("run.list", {
    access: "read",
    description: "List runs for a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 10, max: 50)",
      },
      search: {
        type: "string",
        required: false,
        description: "Search by ciBuildId or commit message",
      },
      status: {
        type: "array",
        required: false,
        description: "Filter by status",
      },
      completionState: {
        type: "array",
        required: false,
        description: "Filter by completion state",
      },
      branches: {
        type: "array",
        required: false,
        description: "Filter by branches",
      },
      authors: {
        type: "array",
        required: false,
        description: "Filter by authors",
      },
      tags: { type: "array", required: false, description: "Filter by tags" },
      dateStart: { type: "string", required: false, description: "Start date" },
      dateEnd: { type: "string", required: false, description: "End date" },
    },
    async execute(input, ctx) {
      const {
        projectId,
        limit,
        search,
        status,
        completionState,
        branches,
        authors,
        tags,
        dateStart,
        dateEnd,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (search) qs.search = search;
      if (status) qs.status = status;
      if (completionState) qs.completion_state = completionState;
      if (branches) qs.branches = branches;
      if (authors) qs.authors = authors;
      if (tags) qs.tags = tags;
      if (dateStart) qs.date_start = dateStart;
      if (dateEnd) qs.date_end = dateEnd;
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/projects/${projectId}/runs`,
          undefined,
          qs,
        ),
      );
    },
  });

  rl.registerAction("run.find", {
    access: "read",
    description: "Find a run by project and filters",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      branch: {
        type: "string",
        required: false,
        description: "Filter by branch",
      },
      ciBuildId: {
        type: "string",
        required: false,
        description: "Filter by CI build ID",
      },
      tags: { type: "array", required: false, description: "Filter by tags" },
    },
    async execute(input, ctx) {
      const { projectId, branch, ciBuildId, tags } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = { projectId };
      if (branch) qs.branch = branch;
      if (ciBuildId) qs.ciBuildId = ciBuildId;
      if (tags) qs.tags = tags;
      return unwrapData(
        await apiRequest(getKey(ctx), "GET", "/runs/find", undefined, qs),
      );
    },
  });

  rl.registerAction("run.cancel", {
    access: "write",
    description: "Cancel a run in progress",
    inputSchema: {
      runId: { type: "string", required: true, description: "Run ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        getKey(ctx),
        "PUT",
        `/runs/${(input as { runId: string }).runId}/cancel`,
      );
    },
  });

  rl.registerAction("run.cancelGithub", {
    access: "write",
    description: "Cancel a run by GitHub Actions workflow run ID",
    inputSchema: {
      githubRunId: {
        type: "string",
        required: true,
        description: "GitHub Actions workflow run ID",
      },
      githubRunAttempt: {
        type: "number",
        required: true,
        description: "Workflow attempt number",
      },
      projectId: {
        type: "string",
        required: false,
        description: "Limit to specific project",
      },
      ciBuildId: {
        type: "string",
        required: false,
        description: "Limit to specific CI build",
      },
    },
    async execute(input, ctx) {
      const body = input as Record<string, unknown>;
      return apiRequest(getKey(ctx), "PUT", "/runs/cancel-ci/github", body);
    },
  });

  rl.registerAction("run.reset", {
    access: "write",
    description: "Reset failed specs for re-execution on specified machines",
    inputSchema: {
      runId: { type: "string", required: true, description: "Run ID" },
      machineIds: {
        type: "array",
        required: true,
        description: "Array of machine identifiers to reset",
      },
      isBatchedOr8n: {
        type: "boolean",
        required: false,
        description: "Enable batched orchestration",
      },
    },
    async execute(input, ctx) {
      const { runId, machineIds, isBatchedOr8n } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { machineId: machineIds };
      if (isBatchedOr8n) body.isBatchedOr8n = true;
      return apiRequest(getKey(ctx), "PUT", `/runs/${runId}/reset`, body);
    },
  });

  rl.registerAction("run.delete", {
    access: "write",
    description: "Delete a run and all associated data",
    inputSchema: {
      runId: { type: "string", required: true, description: "Run ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `/runs/${(input as { runId: string }).runId}`,
      );
      return { success: true };
    },
  });

  // ── Signature ───────────────────────────────────────

  rl.registerAction("signature.generate", {
    access: "write",
    description: "Generate a unique test signature",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      specFilePath: {
        type: "string",
        required: true,
        description: "Full spec file path",
      },
      testTitle: {
        type: "string",
        required: true,
        description: "Test title (use ' > ' for nested describes)",
      },
    },
    async execute(input, ctx) {
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "POST",
          "/signature/test",
          input as Record<string, unknown>,
        ),
      );
    },
  });

  // ── Spec File ───────────────────────────────────────

  rl.registerAction("specFile.list", {
    access: "read",
    description: "Get aggregated spec file metrics for a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      dateStart: {
        type: "string",
        required: true,
        description: "Start date (ISO 8601)",
      },
      dateEnd: {
        type: "string",
        required: true,
        description: "End date (ISO 8601)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 50)",
      },
      order: { type: "string", required: false, description: "Order by field" },
      dir: {
        type: "string",
        required: false,
        description: "Sort direction: asc or desc",
      },
    },
    async execute(input, ctx) {
      const { projectId, dateStart, dateEnd, limit, order, dir } =
        input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        date_start: dateStart,
        date_end: dateEnd,
      };
      if (limit) qs.limit = limit;
      if (order) qs.order = order;
      if (dir) qs.dir = dir;
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/spec-files/${projectId}`,
          undefined,
          qs,
        ),
      );
    },
  });

  // ── Test ────────────────────────────────────────────

  rl.registerAction("test.list", {
    access: "read",
    description: "Get aggregated test metrics for a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID" },
      dateStart: {
        type: "string",
        required: true,
        description: "Start date (ISO 8601)",
      },
      dateEnd: {
        type: "string",
        required: true,
        description: "End date (ISO 8601)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 50)",
      },
      order: { type: "string", required: false, description: "Order by field" },
      dir: {
        type: "string",
        required: false,
        description: "Sort direction: asc or desc",
      },
      title: {
        type: "string",
        required: false,
        description: "Filter by test title",
      },
      spec: {
        type: "string",
        required: false,
        description: "Filter by spec file",
      },
    },
    async execute(input, ctx) {
      const { projectId, dateStart, dateEnd, limit, order, dir, title, spec } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        date_start: dateStart,
        date_end: dateEnd,
      };
      if (limit) qs.limit = limit;
      if (order) qs.order = order;
      if (dir) qs.dir = dir;
      if (title) qs.title = title;
      if (spec) qs.spec = spec;
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/tests/${projectId}`,
          undefined,
          qs,
        ),
      );
    },
  });

  // ── Test Result ─────────────────────────────────────

  rl.registerAction("testResult.list", {
    access: "read",
    description: "Get historical test execution results for a test signature",
    inputSchema: {
      signature: {
        type: "string",
        required: true,
        description: "Test signature",
      },
      dateStart: {
        type: "string",
        required: true,
        description: "Start date (ISO 8601)",
      },
      dateEnd: {
        type: "string",
        required: true,
        description: "End date (ISO 8601)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 10, max: 100)",
      },
      status: {
        type: "array",
        required: false,
        description: "Filter by status: passed, failed, pending, skipped",
      },
      branches: {
        type: "array",
        required: false,
        description: "Filter by branches",
      },
    },
    async execute(input, ctx) {
      const { signature, dateStart, dateEnd, limit, status, branches } =
        input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        date_start: dateStart,
        date_end: dateEnd,
      };
      if (limit) qs.limit = limit;
      if (status) qs.status = status;
      if (branches) qs.branches = branches;
      return unwrapData(
        await apiRequest(
          getKey(ctx),
          "GET",
          `/test-results/${signature}`,
          undefined,
          qs,
        ),
      );
    },
  });
}
