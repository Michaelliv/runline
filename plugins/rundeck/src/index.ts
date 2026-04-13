import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { url: (c.url as string).replace(/\/$/, ""), token: c.token as string };
}

async function apiRequest(
  conn: { url: string; token: string }, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.url}${endpoint}`);
  url.searchParams.set("authtoken", conn.token);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Rundeck error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function rundeck(rl: RunlinePluginAPI) {
  rl.setName("rundeck");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Rundeck server URL (e.g. https://rundeck.example.com)", env: "RUNDECK_URL" },
    token: { type: "string", required: true, description: "Rundeck API token", env: "RUNDECK_TOKEN" },
  });

  rl.registerAction("job.execute", {
    description: "Execute a Rundeck job",
    inputSchema: {
      jobId: { type: "string", required: true },
      arguments: { type: "object", required: false, description: "Array of {name, value} argument pairs" },
      filter: { type: "string", required: false, description: "Node filter string" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const conn = getConn(ctx);
      let argString = "";
      if (p.arguments) {
        for (const arg of p.arguments as Array<{ name: string; value: string }>) {
          argString += `-${arg.name} ${arg.value} `;
        }
      }
      const qs: Record<string, unknown> = {};
      if (p.filter) qs.filter = p.filter;
      return apiRequest(conn, "POST", `/api/14/job/${p.jobId}/run`, { argString: argString.trim() }, qs);
    },
  });

  rl.registerAction("job.getMetadata", {
    description: "Get metadata for a Rundeck job",
    inputSchema: { jobId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { jobId } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "GET", `/api/18/job/${jobId}/info`);
    },
  });
}
