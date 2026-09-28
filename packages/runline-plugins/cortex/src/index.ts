import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { cortexCredential, MAX_WAIT_SECONDS } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  options: {
    target?: "api" | "wait";
    json?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
): Promise<unknown> {
  return credentialJson(ctx, cortexCredential, "cortex", {
    target: options.target ?? "api",
    path,
    method,
    query: options.query,
    ...(options.json && Object.keys(options.json).length > 0
      ? { json: options.json }
      : {}),
  });
}

export default function cortex(rl: RunlinePluginAPI) {
  rl.setName("cortex");
  rl.setVersion("0.1.0");
  rl.setCredential(cortexCredential);

  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description: "Cortex instance URL (e.g. https://cortex.example.com)",
      env: "CORTEX_HOST",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Cortex API key",
      env: "CORTEX_API_KEY",
    },
  });

  // ── Analyzer ────────────────────────────────────────

  rl.registerAction("analyzer.execute", {
    access: "write",
    description: "Run an analyzer on an observable",
    inputSchema: {
      analyzerId: {
        type: "string",
        required: true,
        description: "Analyzer ID",
      },
      dataType: {
        type: "string",
        required: true,
        description:
          "Observable type (domain, ip, url, mail, hash, filename, fqdn, uri_path, user-agent, regexp, registry, mail_subject, other)",
      },
      data: { type: "string", required: true, description: "Observable value" },
      tlp: {
        type: "number",
        required: false,
        description: "TLP level: 0=white, 1=green, 2=amber (default), 3=red",
      },
      force: { type: "boolean", required: false, description: "Bypass cache" },
      timeout: {
        type: "number",
        required: false,
        description:
          "Wait for report (seconds, at most 540). If set, blocks until " +
          "the report is ready.",
      },
    },
    async execute(input, ctx) {
      const {
        analyzerId,
        dataType,
        data,
        tlp = 2,
        force,
        timeout,
      } = input as Record<string, unknown>;

      const result = (await apiRequest(
        ctx,
        "POST",
        `analyzer/${pathSegment(analyzerId)}/run`,
        {
          json: { dataType, data, tlp },
          ...(force ? { query: { force: true } } : {}),
        },
      )) as Record<string, unknown>;

      if (timeout && result.id) {
        // The wait target's declared deadline covers the longest atMost.
        const atMost = Math.min(Number(timeout), MAX_WAIT_SECONDS);
        return apiRequest(
          ctx,
          "GET",
          `job/${pathSegment(result.id)}/waitreport`,
          { target: "wait", query: { atMost: `${atMost}second` } },
        );
      }
      return result;
    },
  });

  // ── Job ─────────────────────────────────────────────

  rl.registerAction("job.get", {
    access: "read",
    description: "Get job details",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID" },
    },
    async execute(input, ctx) {
      const { jobId } = input as { jobId: string };
      return apiRequest(ctx, "GET", `job/${pathSegment(jobId)}`);
    },
  });

  rl.registerAction("job.getReport", {
    access: "read",
    description: "Get job report",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID" },
    },
    async execute(input, ctx) {
      const { jobId } = input as { jobId: string };
      return apiRequest(ctx, "GET", `job/${pathSegment(jobId)}/report`);
    },
  });

  // ── Responder ───────────────────────────────────────

  rl.registerAction("responder.execute", {
    access: "write",
    description: "Run a responder on an entity",
    inputSchema: {
      responderId: {
        type: "string",
        required: true,
        description: "Responder ID",
      },
      entityType: {
        type: "string",
        required: true,
        description:
          "Entity type: case, alert, case_artifact, case_task, case_task_log",
      },
      data: {
        type: "object",
        required: true,
        description:
          "Entity data object (must include _type matching entityType)",
      },
      tlp: {
        type: "number",
        required: false,
        description: "TLP level (default: 2)",
      },
      pap: {
        type: "number",
        required: false,
        description: "PAP level (default: 2)",
      },
      message: { type: "string", required: false, description: "Message" },
    },
    async execute(input, ctx) {
      const {
        responderId,
        entityType,
        data,
        tlp = 2,
        pap = 2,
        message,
      } = input as Record<string, unknown>;
      const entityData = {
        _type: entityType,
        ...(data as Record<string, unknown>),
      };

      const body: Record<string, unknown> = {
        responderId,
        dataType: `thehive:${entityType}`,
        data: entityData,
        tlp,
        pap,
        message: message ?? "",
        parameters: [],
      };

      // Generate label based on entity type
      let label = "";
      switch (entityType) {
        case "case":
          label = `#${entityData.caseId} ${entityData.title}`;
          break;
        case "alert":
          label = `[${entityData.source}:${entityData.sourceRef}] ${entityData.title}`;
          break;
        case "case_artifact":
          label = `[${entityData.dataType}] ${entityData.data ?? ""}`;
          break;
        case "case_task":
          label = `${entityData.title} (${entityData.status})`;
          break;
        case "case_task_log":
          label = `${entityData.message} from ${entityData.createdBy}`;
          break;
      }
      body.label = label;

      return apiRequest(
        ctx,
        "POST",
        `responder/${pathSegment(responderId)}/run`,
        {
          json: body,
        },
      );
    },
  });
}
