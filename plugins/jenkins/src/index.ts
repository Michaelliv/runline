import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string, username: string, apiToken: string, method: string, endpoint: string,
  body?: string | Record<string, unknown>, contentType?: string, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const headers: Record<string, string> = { Authorization: `Basic ${btoa(`${username}:${apiToken}`)}` };
  if (contentType) headers["Content-Type"] = contentType;
  const opts: RequestInit = { method, headers };
  if (body && method !== "GET") opts.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Jenkins error ${res.status}: ${await res.text()}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    baseUrl: (ctx.connection.config.baseUrl as string).replace(/\/$/, ""),
    username: ctx.connection.config.username as string,
    apiToken: ctx.connection.config.apiToken as string,
  };
}

function jk(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: string | Record<string, unknown>, ct?: string, qs?: Record<string, unknown>) {
  const { baseUrl, username, apiToken } = getConn(ctx);
  return apiRequest(baseUrl, username, apiToken, method, endpoint, body, ct, qs);
}

export default function jenkins(rl: RunlinePluginAPI) {
  rl.setName("jenkins");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    baseUrl: { type: "string", required: true, description: "Jenkins URL (e.g. https://jenkins.example.com)", env: "JENKINS_URL" },
    username: { type: "string", required: true, description: "Jenkins username", env: "JENKINS_USER" },
    apiToken: { type: "string", required: true, description: "Jenkins API token", env: "JENKINS_TOKEN" },
  });

  // ── Job ─────────────────────────────────────────────

  rl.registerAction("job.trigger", {
    description: "Trigger a job build",
    inputSchema: {
      jobName: { type: "string", required: true, description: "Job name (URL-encoded if nested)" },
      parameters: { type: "object", required: false, description: "Build parameters as key-value pairs" },
    },
    async execute(input, ctx) {
      const { jobName, parameters } = input as Record<string, unknown>;
      if (parameters && Object.keys(parameters as Record<string, unknown>).length > 0) {
        const qs = parameters as Record<string, unknown>;
        await jk(ctx, "POST", `/job/${jobName}/buildWithParameters`, undefined, undefined, qs);
      } else {
        await jk(ctx, "POST", `/job/${jobName}/build`);
      }
      return { success: true };
    },
  });

  rl.registerAction("job.getParameters", {
    description: "Get build parameters for a job",
    inputSchema: { jobName: { type: "string", required: true, description: "Job name" } },
    async execute(input, ctx) {
      const data = (await jk(ctx, "GET", `/job/${(input as { jobName: string }).jobName}/api/json`, undefined, undefined, { tree: "actions[parameterDefinitions[*]]" })) as Record<string, unknown>;
      return data.actions;
    },
  });

  rl.registerAction("job.copy", {
    description: "Copy/create a job from an existing one",
    inputSchema: {
      fromJob: { type: "string", required: true, description: "Source job name" },
      newName: { type: "string", required: true, description: "New job name" },
    },
    async execute(input, ctx) {
      const { fromJob, newName } = input as { fromJob: string; newName: string };
      await jk(ctx, "POST", "/createItem", undefined, undefined, { name: newName, mode: "copy", from: fromJob });
      return { success: true };
    },
  });

  rl.registerAction("job.create", {
    description: "Create a job from XML config",
    inputSchema: {
      name: { type: "string", required: true, description: "Job name" },
      xml: { type: "string", required: true, description: "Jenkins job config XML" },
    },
    async execute(input, ctx) {
      const { name, xml } = input as { name: string; xml: string };
      await jk(ctx, "POST", "/createItem", xml, "application/xml", { name });
      return { success: true };
    },
  });

  // ── Build ───────────────────────────────────────────

  rl.registerAction("build.list", {
    description: "List builds for a job",
    inputSchema: {
      jobName: { type: "string", required: true, description: "Job name" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { jobName, limit } = input as Record<string, unknown>;
      const tree = limit ? `builds[*]{0,${limit}}` : "builds[*]";
      const data = (await jk(ctx, "GET", `/job/${jobName}/api/json`, undefined, undefined, { tree })) as Record<string, unknown>;
      return data.builds;
    },
  });

  // ── Instance ────────────────────────────────────────

  rl.registerAction("instance.quietDown", {
    description: "Put Jenkins into quiet mode (no new builds)",
    async execute(_input, ctx) { await jk(ctx, "POST", "/quietDown"); return { success: true }; },
  });

  rl.registerAction("instance.cancelQuietDown", {
    description: "Cancel quiet mode",
    async execute(_input, ctx) { await jk(ctx, "POST", "/cancelQuietDown"); return { success: true }; },
  });

  rl.registerAction("instance.restart", {
    description: "Restart Jenkins immediately",
    async execute(_input, ctx) { await jk(ctx, "POST", "/restart"); return { success: true }; },
  });

  rl.registerAction("instance.safeRestart", {
    description: "Restart Jenkins after running builds finish",
    async execute(_input, ctx) { await jk(ctx, "POST", "/safeRestart"); return { success: true }; },
  });

  rl.registerAction("instance.exit", {
    description: "Shut down Jenkins immediately",
    async execute(_input, ctx) { await jk(ctx, "POST", "/exit"); return { success: true }; },
  });

  rl.registerAction("instance.safeExit", {
    description: "Shut down Jenkins after running builds finish",
    async execute(_input, ctx) { await jk(ctx, "POST", "/safeExit"); return { success: true }; },
  });
}
