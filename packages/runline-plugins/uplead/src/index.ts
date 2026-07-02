import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.uplead.com/v2";

async function apiRequest(
  apiKey: string,
  endpoint: string,
  qs: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });
  if (!res.ok)
    throw new Error(`Uplead error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  return data.data;
}

export default function uplead(rl: RunlinePluginAPI) {
  rl.setName("uplead");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Uplead API key",
      env: "UPLEAD_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  rl.registerAction("person.enrich", {
    access: "write",
    description: "Enrich a person by email or name+domain",
    inputSchema: {
      email: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      domain: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.email) qs.email = p.email;
      if (p.firstName) qs.first_name = p.firstName;
      if (p.lastName) qs.last_name = p.lastName;
      if (p.domain) qs.domain = p.domain;
      return apiRequest(key(ctx), "/person-search", qs);
    },
  });

  rl.registerAction("company.enrich", {
    access: "write",
    description: "Enrich a company by domain or name",
    inputSchema: {
      domain: { type: "string", required: false },
      company: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.domain) qs.domain = p.domain;
      if (p.company) qs.company = p.company;
      return apiRequest(key(ctx), "/company-search", qs);
    },
  });
}
