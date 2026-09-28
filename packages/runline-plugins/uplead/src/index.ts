import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { upleadCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  path: string,
  qs: Record<string, unknown>,
): Promise<unknown> {
  const data = (await credentialJson(ctx, upleadCredential, "uplead", {
    target: "api",
    path,
    query: qs,
  })) as Record<string, unknown>;
  return data.data;
}

export default function uplead(rl: RunlinePluginAPI) {
  rl.setName("uplead");
  rl.setVersion("0.1.0");
  rl.setCredential(upleadCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Uplead API key",
      env: "UPLEAD_API_KEY",
    },
  });

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
      return apiRequest(ctx, "person-search", qs);
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
      return apiRequest(ctx, "company-search", qs);
    },
  });
}
