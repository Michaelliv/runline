import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { tapfiliateCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, tapfiliateCredential, "tapfiliate", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function tapfiliate(rl: RunlinePluginAPI) {
  rl.setName("tapfiliate");
  rl.setVersion("0.1.0");
  rl.setCredential(tapfiliateCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Tapfiliate API key",
      env: "TAPFILIATE_API_KEY",
    },
  });

  // ── Affiliate ───────────────────────────────────────

  rl.registerAction("affiliate.create", {
    access: "write",
    description: "Create an affiliate",
    inputSchema: {
      firstname: { type: "string", required: true },
      lastname: { type: "string", required: true },
      email: { type: "string", required: true },
      companyName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        firstname: p.firstname,
        lastname: p.lastname,
        email: p.email,
      };
      if (p.companyName) body.company = { name: p.companyName };
      return apiRequest(ctx, "POST", "affiliates/", body);
    },
  });

  rl.registerAction("affiliate.get", {
    access: "read",
    description: "Get an affiliate by ID",
    inputSchema: { affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `affiliates/${pathSegment((input as Record<string, unknown>).affiliateId)}/`,
      );
    },
  });

  rl.registerAction("affiliate.list", {
    access: "read",
    description: "List affiliates",
    inputSchema: {
      limit: { type: "number", required: false },
      email: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.email) qs.email = p.email;
      const data = (await apiRequest(
        ctx,
        "GET",
        "affiliates/",
        undefined,
        qs,
      )) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("affiliate.delete", {
    access: "write",
    description: "Delete an affiliate",
    inputSchema: { affiliateId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `affiliates/${pathSegment((input as Record<string, unknown>).affiliateId)}/`,
      );
      return { success: true };
    },
  });

  // ── Affiliate Metadata ──────────────────────────────

  rl.registerAction("affiliateMetadata.set", {
    access: "write",
    description: "Set metadata key-value on an affiliate",
    inputSchema: {
      affiliateId: { type: "string", required: true },
      key: { type: "string", required: true },
      value: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PUT",
        `affiliates/${pathSegment(p.affiliateId)}/meta-data/${pathSegment(p.key)}/`,
        { value: p.value },
      );
    },
  });

  rl.registerAction("affiliateMetadata.delete", {
    access: "write",
    description: "Delete a metadata key from an affiliate",
    inputSchema: {
      affiliateId: { type: "string", required: true },
      key: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `affiliates/${pathSegment(p.affiliateId)}/meta-data/${pathSegment(p.key)}/`,
      );
      return { success: true };
    },
  });

  // ── Program Affiliate ───────────────────────────────

  rl.registerAction("programAffiliate.add", {
    access: "write",
    description: "Add an affiliate to a program",
    inputSchema: {
      programId: { type: "string", required: true },
      affiliateId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `programs/${pathSegment(p.programId)}/affiliates/`,
        { affiliate: { id: p.affiliateId } },
      );
    },
  });

  rl.registerAction("programAffiliate.approve", {
    access: "write",
    description: "Approve an affiliate for a program",
    inputSchema: {
      programId: { type: "string", required: true },
      affiliateId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PUT",
        `programs/${pathSegment(p.programId)}/affiliates/${pathSegment(p.affiliateId)}/approved/`,
      );
    },
  });

  rl.registerAction("programAffiliate.disapprove", {
    access: "write",
    description: "Disapprove an affiliate for a program",
    inputSchema: {
      programId: { type: "string", required: true },
      affiliateId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `programs/${pathSegment(p.programId)}/affiliates/${pathSegment(p.affiliateId)}/approved/`,
      );
      return { success: true };
    },
  });

  rl.registerAction("programAffiliate.get", {
    access: "read",
    description: "Get an affiliate in a program",
    inputSchema: {
      programId: { type: "string", required: true },
      affiliateId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `programs/${pathSegment(p.programId)}/affiliates/${pathSegment(p.affiliateId)}/`,
      );
    },
  });

  rl.registerAction("programAffiliate.list", {
    access: "read",
    description: "List affiliates in a program",
    inputSchema: {
      programId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `programs/${pathSegment(p.programId)}/affiliates/`,
      )) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });
}
