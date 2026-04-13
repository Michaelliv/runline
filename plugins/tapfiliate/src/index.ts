import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.tapfiliate.com/1.6";

async function apiRequest(
  apiKey: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "Api-Key": apiKey, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Tapfiliate error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function tapfiliate(rl: RunlinePluginAPI) {
  rl.setName("tapfiliate");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "Tapfiliate API key", env: "TAPFILIATE_API_KEY" } });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Affiliate ───────────────────────────────────────

  rl.registerAction("affiliate.create", {
    description: "Create an affiliate",
    inputSchema: {
      firstname: { type: "string", required: true }, lastname: { type: "string", required: true },
      email: { type: "string", required: true }, companyName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { firstname: p.firstname, lastname: p.lastname, email: p.email };
      if (p.companyName) body.company = { name: p.companyName };
      return apiRequest(key(ctx), "POST", "/affiliates/", body);
    },
  });

  rl.registerAction("affiliate.get", {
    description: "Get an affiliate by ID",
    inputSchema: { affiliateId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(key(ctx), "GET", `/affiliates/${(input as Record<string, unknown>).affiliateId}/`); },
  });

  rl.registerAction("affiliate.list", {
    description: "List affiliates",
    inputSchema: { limit: { type: "number", required: false }, email: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.email) qs.email = p.email;
      const data = (await apiRequest(key(ctx), "GET", "/affiliates/", undefined, qs)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("affiliate.delete", {
    description: "Delete an affiliate",
    inputSchema: { affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(key(ctx), "DELETE", `/affiliates/${(input as Record<string, unknown>).affiliateId}/`);
      return { success: true };
    },
  });

  // ── Affiliate Metadata ──────────────────────────────

  rl.registerAction("affiliateMetadata.set", {
    description: "Set metadata key-value on an affiliate",
    inputSchema: { affiliateId: { type: "string", required: true }, key: { type: "string", required: true }, value: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", `/affiliates/${p.affiliateId}/meta-data/${p.key}/`, { value: p.value });
    },
  });

  rl.registerAction("affiliateMetadata.delete", {
    description: "Delete a metadata key from an affiliate",
    inputSchema: { affiliateId: { type: "string", required: true }, key: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(key(ctx), "DELETE", `/affiliates/${p.affiliateId}/meta-data/${p.key}/`);
      return { success: true };
    },
  });

  // ── Program Affiliate ───────────────────────────────

  rl.registerAction("programAffiliate.add", {
    description: "Add an affiliate to a program",
    inputSchema: { programId: { type: "string", required: true }, affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "POST", `/programs/${p.programId}/affiliates/`, { affiliate: { id: p.affiliateId } });
    },
  });

  rl.registerAction("programAffiliate.approve", {
    description: "Approve an affiliate for a program",
    inputSchema: { programId: { type: "string", required: true }, affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", `/programs/${p.programId}/affiliates/${p.affiliateId}/approved/`);
    },
  });

  rl.registerAction("programAffiliate.disapprove", {
    description: "Disapprove an affiliate for a program",
    inputSchema: { programId: { type: "string", required: true }, affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(key(ctx), "DELETE", `/programs/${p.programId}/affiliates/${p.affiliateId}/approved/`);
      return { success: true };
    },
  });

  rl.registerAction("programAffiliate.get", {
    description: "Get an affiliate in a program",
    inputSchema: { programId: { type: "string", required: true }, affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "GET", `/programs/${p.programId}/affiliates/${p.affiliateId}/`);
    },
  });

  rl.registerAction("programAffiliate.list", {
    description: "List affiliates in a program",
    inputSchema: { programId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", `/programs/${p.programId}/affiliates/`)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });
}
