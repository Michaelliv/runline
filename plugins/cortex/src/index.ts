import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  host: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${host}/api${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Cortex API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    host: (ctx.connection.config.host as string).replace(/\/$/, ""),
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function cortex(rl: RunlinePluginAPI) {
  rl.setName("cortex");
  rl.setVersion("0.1.0");

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
    description: "Run an analyzer on an observable",
    inputSchema: {
      analyzerId: { type: "string", required: true, description: "Analyzer ID" },
      dataType: { type: "string", required: true, description: "Observable type (domain, ip, url, mail, hash, filename, fqdn, uri_path, user-agent, regexp, registry, mail_subject, other)" },
      data: { type: "string", required: true, description: "Observable value" },
      tlp: { type: "number", required: false, description: "TLP level: 0=white, 1=green, 2=amber (default), 3=red" },
      force: { type: "boolean", required: false, description: "Bypass cache" },
      timeout: { type: "number", required: false, description: "Wait for report (seconds). If set, blocks until report is ready." },
    },
    async execute(input, ctx) {
      const { analyzerId, dataType, data, tlp = 2, force, timeout } = input as Record<string, unknown>;
      const { host, apiKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (force) qs.force = true;

      const result = (await apiRequest(host, apiKey, "POST", `/analyzer/${analyzerId}/run`, {
        dataType,
        data,
        tlp,
      }, qs)) as Record<string, unknown>;

      if (timeout && result.id) {
        return apiRequest(host, apiKey, "GET", `/job/${result.id}/waitreport`, undefined, {
          atMost: `${timeout}second`,
        });
      }
      return result;
    },
  });

  // ── Job ─────────────────────────────────────────────

  rl.registerAction("job.get", {
    description: "Get job details",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID" },
    },
    async execute(input, ctx) {
      const { jobId } = input as { jobId: string };
      const { host, apiKey } = getConn(ctx);
      return apiRequest(host, apiKey, "GET", `/job/${jobId}`);
    },
  });

  rl.registerAction("job.getReport", {
    description: "Get job report",
    inputSchema: {
      jobId: { type: "string", required: true, description: "Job ID" },
    },
    async execute(input, ctx) {
      const { jobId } = input as { jobId: string };
      const { host, apiKey } = getConn(ctx);
      return apiRequest(host, apiKey, "GET", `/job/${jobId}/report`);
    },
  });

  // ── Responder ───────────────────────────────────────

  rl.registerAction("responder.execute", {
    description: "Run a responder on an entity",
    inputSchema: {
      responderId: { type: "string", required: true, description: "Responder ID" },
      entityType: { type: "string", required: true, description: "Entity type: case, alert, case_artifact, case_task, case_task_log" },
      data: { type: "object", required: true, description: "Entity data object (must include _type matching entityType)" },
      tlp: { type: "number", required: false, description: "TLP level (default: 2)" },
      pap: { type: "number", required: false, description: "PAP level (default: 2)" },
      message: { type: "string", required: false, description: "Message" },
    },
    async execute(input, ctx) {
      const { responderId, entityType, data, tlp = 2, pap = 2, message } = input as Record<string, unknown>;
      const { host, apiKey } = getConn(ctx);
      const entityData = { _type: entityType, ...(data as Record<string, unknown>) };

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

      return apiRequest(host, apiKey, "POST", `/responder/${responderId}/run`, body);
    },
  });
}
