import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { lemlistCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, lemlistCredential, "lemlist", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 100;
  qs.offset = 0;
  let data: unknown[];
  do {
    data = (await apiRequest(ctx, method, path, undefined, qs)) as unknown[];
    all.push(...data);
    (qs.offset as number) += qs.limit as number;
  } while (data.length > 0);
  return all;
}

export default function lemlist(rl: RunlinePluginAPI) {
  rl.setName("lemlist");
  rl.setVersion("0.1.0");
  rl.setCredential(lemlistCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Lemlist API key",
      env: "LEMLIST_API_KEY",
    },
  });

  // ── Activity ────────────────────────────────────────

  rl.registerAction("activity.list", {
    access: "read",
    description: "List activities",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      campaignId: {
        type: "string",
        required: false,
        description: "Filter by campaign ID",
      },
      type: {
        type: "string",
        required: false,
        description: "Filter by activity type",
      },
      isFirst: {
        type: "boolean",
        required: false,
        description: "Filter first activities only",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.campaignId) qs.campaignId = p.campaignId;
      if (p.type) qs.type = p.type;
      if (p.isFirst !== undefined) qs.isFirst = p.isFirst;
      if (p.limit) {
        qs.limit = p.limit;
        return apiRequest(ctx, "GET", "activities", undefined, qs);
      }
      return paginate(ctx, "GET", "activities", qs);
    },
  });

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.list", {
    access: "read",
    description: "List campaigns",
    inputSchema: {
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit)
        return apiRequest(ctx, "GET", "campaigns", undefined, {
          limit: p.limit,
        });
      return paginate(ctx, "GET", "campaigns");
    },
  });

  rl.registerAction("campaign.getStats", {
    access: "read",
    description: "Get campaign statistics",
    inputSchema: {
      campaignId: { type: "string", required: true },
      startDate: {
        type: "string",
        required: true,
        description: "Start date (YYYY-MM-DD)",
      },
      endDate: {
        type: "string",
        required: true,
        description: "End date (YYYY-MM-DD)",
      },
      timezone: {
        type: "string",
        required: true,
        description: "Timezone (e.g. America/New_York)",
      },
    },
    async execute(input, ctx) {
      const { campaignId, startDate, endDate, timezone } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        ctx,
        "GET",
        `campaigns/${seg(campaignId)}/stats`,
        undefined,
        { startDate, endDate, timezone } as Record<string, unknown>,
      );
    },
  });

  // ── Lead ────────────────────────────────────────────

  rl.registerAction("lead.create", {
    access: "write",
    description: "Add a lead to a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
      deduplicate: {
        type: "boolean",
        required: false,
        description: "Deduplicate by email",
      },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      companyName: { type: "string", required: false },
      additionalFields: {
        type: "object",
        required: false,
        description: "Any extra fields",
      },
    },
    async execute(input, ctx) {
      const {
        campaignId,
        email,
        deduplicate,
        firstName,
        lastName,
        companyName,
        additionalFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
      if (companyName) body.companyName = companyName;
      if (additionalFields) Object.assign(body, additionalFields);
      const qs: Record<string, unknown> = {};
      if (deduplicate !== undefined) qs.deduplicate = deduplicate;
      return apiRequest(
        ctx,
        "POST",
        `campaigns/${seg(campaignId)}/leads/${seg(email)}`,
        body,
        Object.keys(qs).length > 0 ? qs : undefined,
      );
    },
  });

  rl.registerAction("lead.get", {
    access: "read",
    description: "Get a lead by email",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `leads/${seg((input as { email: string }).email)}`,
      );
    },
  });

  rl.registerAction("lead.delete", {
    access: "write",
    description:
      "Remove a lead from a campaign (keeps lead in unsubscribe list)",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, email } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `campaigns/${seg(campaignId)}/leads/${seg(email)}`,
        undefined,
        { action: "remove" },
      );
    },
  });

  rl.registerAction("lead.unsubscribe", {
    access: "write",
    description: "Unsubscribe a lead from a campaign",
    inputSchema: {
      campaignId: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { campaignId, email } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `campaigns/${seg(campaignId)}/leads/${seg(email)}`,
      );
    },
  });

  // ── Team ────────────────────────────────────────────

  rl.registerAction("team.get", {
    access: "read",
    description: "Get team information",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "team");
    },
  });

  rl.registerAction("team.getCredits", {
    access: "read",
    description: "Get team credits",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "team/credits");
    },
  });

  // ── Unsubscribe ─────────────────────────────────────

  rl.registerAction("unsubscribe.add", {
    access: "write",
    description: "Add an email to the unsubscribe list",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `unsubscribes/${seg((input as { email: string }).email)}`,
      );
    },
  });

  rl.registerAction("unsubscribe.delete", {
    access: "write",
    description: "Remove an email from the unsubscribe list",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `unsubscribes/${seg((input as { email: string }).email)}`,
      );
    },
  });

  rl.registerAction("unsubscribe.list", {
    access: "read",
    description: "List all unsubscribed emails",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit)
        return apiRequest(ctx, "GET", "unsubscribes", undefined, {
          limit: p.limit,
        });
      return paginate(ctx, "GET", "unsubscribes");
    },
  });

  // ── Enrichment ──────────────────────────────────────

  rl.registerAction("enrich.get", {
    access: "read",
    description: "Get an enrichment result by ID",
    inputSchema: { enrichId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `enrich/${seg((input as { enrichId: string }).enrichId)}`,
      );
    },
  });

  rl.registerAction("enrich.lead", {
    access: "write",
    description: "Enrich a lead by ID",
    inputSchema: {
      leadId: { type: "string", required: true },
      findEmail: { type: "boolean", required: true },
      verifyEmail: { type: "boolean", required: true },
      linkedinEnrichment: { type: "boolean", required: true },
      findPhone: { type: "boolean", required: true },
    },
    async execute(input, ctx) {
      const { leadId, findEmail, verifyEmail, linkedinEnrichment, findPhone } =
        input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `leads/${seg(leadId)}/enrich/`, {}, {
        findEmail,
        verifyEmail,
        linkedinEnrichment,
        findPhone,
      } as Record<string, unknown>);
    },
  });

  rl.registerAction("enrich.person", {
    access: "write",
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
      const { findEmail, verifyEmail, linkedinEnrichment, findPhone, ...rest } =
        input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        findEmail,
        verifyEmail,
        linkedinEnrichment,
        findPhone,
      };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null) qs[k] = v;
      }
      return apiRequest(ctx, "POST", "enrich/", {}, qs);
    },
  });
}
