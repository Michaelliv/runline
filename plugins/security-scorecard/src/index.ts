import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.securityscorecard.io";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}/${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`SecurityScorecard error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function securityScorecard(rl: RunlinePluginAPI) {
  rl.setName("security-scorecard");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "SecurityScorecard API key", env: "SECURITYSCORECARD_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.getScorecard", {
    description: "Get a company's scorecard by domain",
    inputSchema: { domain: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "GET", `companies/${(input as Record<string, unknown>).domain}`);
    },
  });

  rl.registerAction("company.getFactors", {
    description: "Get factor scores for a company",
    inputSchema: { domain: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", `companies/${p.domain}/factors`)) as Record<string, unknown>;
      let entries = (data.entries ?? []) as unknown[];
      if (p.limit) entries = entries.slice(0, p.limit as number);
      return entries;
    },
  });

  rl.registerAction("company.getHistoricalScore", {
    description: "Get historical score data for a company",
    inputSchema: {
      domain: { type: "string", required: true },
      from: { type: "string", required: false, description: "Start date YYYY-MM-DD" },
      to: { type: "string", required: false, description: "End date YYYY-MM-DD" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.from) qs.from = p.from;
      if (p.to) qs.to = p.to;
      const data = (await apiRequest(key(ctx), "GET", `companies/${p.domain}/history/factors/score`, undefined, qs)) as Record<string, unknown>;
      let entries = (data.entries ?? []) as unknown[];
      if (p.limit) entries = entries.slice(0, p.limit as number);
      return entries;
    },
  });

  rl.registerAction("company.getScorePlan", {
    description: "Get score improvement plan for a target score",
    inputSchema: {
      domain: { type: "string", required: true },
      targetScore: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", `companies/${p.domain}/score-plans/by-target/${p.targetScore}`)) as Record<string, unknown>;
      return data.entries;
    },
  });

  // ── Industry ────────────────────────────────────────

  rl.registerAction("industry.getScore", {
    description: "Get an industry's average score",
    inputSchema: { industry: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "GET", `industries/${(input as Record<string, unknown>).industry}/score`);
    },
  });

  // ── Portfolio ───────────────────────────────────────

  rl.registerAction("portfolio.create", {
    description: "Create a portfolio",
    inputSchema: {
      name: { type: "string", required: true },
      description: { type: "string", required: true },
      privacy: { type: "string", required: true, description: "private or shared" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "POST", "portfolios", { name: p.name, description: p.description, privacy: p.privacy });
    },
  });

  rl.registerAction("portfolio.list", {
    description: "List all portfolios",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "GET", "portfolios")) as Record<string, unknown>;
      let entries = (data.entries ?? []) as unknown[];
      if ((input as Record<string, unknown>)?.limit) entries = entries.slice(0, (input as Record<string, unknown>).limit as number);
      return entries;
    },
  });

  rl.registerAction("portfolio.delete", {
    description: "Delete a portfolio",
    inputSchema: { portfolioId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(key(ctx), "DELETE", `portfolios/${(input as Record<string, unknown>).portfolioId}`);
      return { success: true };
    },
  });

  rl.registerAction("portfolioCompany.add", {
    description: "Add a company to a portfolio",
    inputSchema: { portfolioId: { type: "string", required: true }, domain: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", `portfolios/${p.portfolioId}/companies/${p.domain}`);
    },
  });

  rl.registerAction("portfolioCompany.remove", {
    description: "Remove a company from a portfolio",
    inputSchema: { portfolioId: { type: "string", required: true }, domain: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(key(ctx), "DELETE", `portfolios/${p.portfolioId}/companies/${p.domain}`);
      return { success: true };
    },
  });

  rl.registerAction("portfolioCompany.list", {
    description: "List companies in a portfolio",
    inputSchema: { portfolioId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", `portfolios/${p.portfolioId}/companies`)) as Record<string, unknown>;
      let entries = (data.entries ?? []) as unknown[];
      if (p.limit) entries = entries.slice(0, p.limit as number);
      return entries;
    },
  });

  // ── Invite ──────────────────────────────────────────

  rl.registerAction("invite.create", {
    description: "Send an invitation",
    inputSchema: {
      email: { type: "string", required: true },
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "POST", "invitations", {
        email: p.email, first_name: p.firstName, last_name: p.lastName, message: p.message,
      });
    },
  });

  // ── Report ──────────────────────────────────────────

  rl.registerAction("report.generate", {
    description: "Generate a report",
    inputSchema: {
      reportType: { type: "string", required: true, description: "Report type: detailed, summary, issues, portfolio, events-json, full-scorecard-json, scorecard-footprint" },
      scorecardIdentifier: { type: "string", required: false, description: "Company domain (for non-portfolio reports)" },
      portfolioId: { type: "string", required: false, description: "Portfolio ID (for portfolio reports)" },
      format: { type: "string", required: false, description: "pdf or csv (for issues/portfolio)" },
      branding: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.reportType !== "portfolio") body.scorecard_identifier = p.scorecardIdentifier;
      else body.portfolio_id = p.portfolioId;
      if (p.format) body.format = p.format;
      if (p.branding) body.branding = p.branding;
      return apiRequest(key(ctx), "POST", `reports/${p.reportType}`, body);
    },
  });

  rl.registerAction("report.list", {
    description: "List recent reports",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "GET", "reports/recent")) as Record<string, unknown>;
      let entries = (data.entries ?? []) as unknown[];
      if ((input as Record<string, unknown>)?.limit) entries = entries.slice(0, (input as Record<string, unknown>).limit as number);
      return entries;
    },
  });
}
