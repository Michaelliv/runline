import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.lemlist.com/api";

async function apiRequest(
  apiKey: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Basic ${btoa(`:${apiKey}`)}`, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Lemlist API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

async function paginate(
  apiKey: string, method: string, endpoint: string, qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 100;
  qs.offset = 0;
  let data: unknown[];
  do {
    data = (await apiRequest(apiKey, method, endpoint, undefined, qs)) as unknown[];
    all.push(...data);
    (qs.offset as number) += qs.limit as number;
  } while (data.length > 0);
  return all;
}

export default function lemlist(rl: RunlinePluginAPI) {
  rl.setName("lemlist");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Lemlist API key", env: "LEMLIST_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Activity ────────────────────────────────────────

  rl.registerAction("activity.list", {
    description: "List activities",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      campaignId: { type: "string", required: false, description: "Filter by campaign ID" },
      type: { type: "string", required: false, description: "Filter by activity type" },
      isFirst: { type: "boolean", required: false, description: "Filter first activities only" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.campaignId) qs.campaignId = p.campaignId;
      if (p.type) qs.type = p.type;
      if (p.isFirst !== undefined) qs.isFirst = p.isFirst;
      if (p.limit) {
        qs.limit = p.limit;
        return apiRequest(key(ctx), "GET", "/activities", undefined, qs);
      }
      return paginate(key(ctx), "GET", "/activities", qs);
    },
  });

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.list", {
    description: "List campaigns",
    inputSchema: {
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) return apiRequest(key(ctx), "GET", "/campaigns", undefined, { limit: p.limit });
      return paginate(key(ctx), "GET", "/campaigns");
    },
  });

  rl.registerAction("campaign.getStats", {
    description: "Get campaign statistics",
    inputSchema: {
      campaignId: { type: "string", required: true },
      startDate: { type: "string", required: true, description: "Start date (YYYY-MM-DD)" },
      endDate: { type: "string", required: true, description: "End date (YYYY-MM-DD)" },
      timezone: { type: "string", required: true, description: "Timezone (e.g. America/New_York)" },
    },
    async execute(input, ctx) {
      const { campaignId, startDate, endDate, timezone } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "GET", `/campaigns/${campaignId}/stats`, undefined, { startDate, endDate, timezone } as Record<string, unknown>);
    },
  });

  // ── Lead ────────────────────────────────────────────

  rl.registerAction("lead.create", {
    description: "Add a lead to a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
      deduplicate: { type: "boolean", required: false, description: "Deduplicate by email" },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      companyName: { type: "string", required: false },
      additionalFields: { type: "object", required: false, description: "Any extra fields" },
    },
    async execute(input, ctx) {
      const { campaignId, email, deduplicate, firstName, lastName, companyName, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
      if (companyName) body.companyName = companyName;
      if (additionalFields) Object.assign(body, additionalFields);
      const qs: Record<string, unknown> = {};
      if (deduplicate !== undefined) qs.deduplicate = deduplicate;
      return apiRequest(key(ctx), "POST", `/campaigns/${campaignId}/leads/${encodeURIComponent(email as string)}`, body, Object.keys(qs).length > 0 ? qs : undefined);
    },
  });

  rl.registerAction("lead.get", {
    description: "Get a lead by email",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "GET", `/leads/${encodeURIComponent((input as { email: string }).email)}`);
    },
  });

  rl.registerAction("lead.delete", {
    description: "Remove a lead from a campaign (keeps lead in unsubscribe list)",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, email } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "DELETE", `/campaigns/${campaignId}/leads/${encodeURIComponent(email as string)}`, undefined, { action: "remove" });
    },
  });

  rl.registerAction("lead.unsubscribe", {
    description: "Unsubscribe a lead from a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, email } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "DELETE", `/campaigns/${campaignId}/leads/${encodeURIComponent(email as string)}`);
    },
  });

  // ── Team ────────────────────────────────────────────

  rl.registerAction("team.get", {
    description: "Get team information",
    async execute(_input, ctx) { return apiRequest(key(ctx), "GET", "/team"); },
  });

  rl.registerAction("team.getCredits", {
    description: "Get team credits",
    async execute(_input, ctx) { return apiRequest(key(ctx), "GET", "/team/credits"); },
  });

  // ── Unsubscribe ─────────────────────────────────────

  rl.registerAction("unsubscribe.add", {
    description: "Add an email to the unsubscribe list",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "POST", `/unsubscribes/${encodeURIComponent((input as { email: string }).email)}`);
    },
  });

  rl.registerAction("unsubscribe.delete", {
    description: "Remove an email from the unsubscribe list",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "DELETE", `/unsubscribes/${encodeURIComponent((input as { email: string }).email)}`);
    },
  });

  rl.registerAction("unsubscribe.list", {
    description: "List all unsubscribed emails",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) return apiRequest(key(ctx), "GET", "/unsubscribes", undefined, { limit: p.limit });
      return paginate(key(ctx), "GET", "/unsubscribes");
    },
  });

  // ── Enrichment ──────────────────────────────────────

  rl.registerAction("enrich.get", {
    description: "Get an enrichment result by ID",
    inputSchema: { enrichId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "GET", `/enrich/${(input as { enrichId: string }).enrichId}`);
    },
  });

  rl.registerAction("enrich.lead", {
    description: "Enrich a lead by ID",
    inputSchema: {
      leadId: { type: "string", required: true },
      findEmail: { type: "boolean", required: true },
      verifyEmail: { type: "boolean", required: true },
      linkedinEnrichment: { type: "boolean", required: true },
      findPhone: { type: "boolean", required: true },
    },
    async execute(input, ctx) {
      const { leadId, findEmail, verifyEmail, linkedinEnrichment, findPhone } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "POST", `/leads/${leadId}/enrich/`, {}, { findEmail, verifyEmail, linkedinEnrichment, findPhone } as Record<string, unknown>);
    },
  });

  rl.registerAction("enrich.person", {
    description: "Enrich a person (without existing lead)",
    inputSchema: {
      findEmail: { type: "boolean", required: true },
      verifyEmail: { type: "boolean", required: true },
      linkedinEnrichment: { type: "boolean", required: true },
      findPhone: { type: "boolean", required: true },
      email: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      linkedinUrl: { type: "string", required: false },
      companyName: { type: "string", required: false },
      companyDomain: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { findEmail, verifyEmail, linkedinEnrichment, findPhone, ...rest } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { findEmail, verifyEmail, linkedinEnrichment, findPhone };
      for (const [k, v] of Object.entries(rest)) { if (v !== undefined && v !== null) qs[k] = v; }
      return apiRequest(key(ctx), "POST", "/enrich/", {}, qs);
    },
  });
}
