import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { brandfetchCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  domain: string,
): Promise<Record<string, unknown>> {
  return credentialJson(ctx, brandfetchCredential, "brandfetch", {
    target: "api",
    path: `brands/${encodeURIComponent(domain)}`,
  }) as Promise<Record<string, unknown>>;
}

export default function brandfetch(rl: RunlinePluginAPI) {
  rl.setName("brandfetch");
  rl.setVersion("0.1.0");
  rl.setCredential(brandfetchCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Brandfetch API key",
      env: "BRANDFETCH_API_KEY",
    },
  });

  rl.registerAction("brand.getLogos", {
    access: "read",
    description: "Get a company's logos and icons",
    inputSchema: {
      domain: {
        type: "string",
        required: true,
        description: "Company domain (e.g. nike.com)",
      },
    },
    async execute(input, ctx) {
      const { domain } = input as { domain: string };
      const data = await apiRequest(ctx, domain);
      return data.logos;
    },
  });

  rl.registerAction("brand.getColors", {
    access: "read",
    description: "Get a company's brand colors",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
    },
    async execute(input, ctx) {
      const { domain } = input as { domain: string };
      const data = await apiRequest(ctx, domain);
      return data.colors;
    },
  });

  rl.registerAction("brand.getFonts", {
    access: "read",
    description: "Get a company's fonts",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
    },
    async execute(input, ctx) {
      const { domain } = input as { domain: string };
      const data = await apiRequest(ctx, domain);
      return data.fonts;
    },
  });

  rl.registerAction("brand.getCompany", {
    access: "read",
    description: "Get a company's data (name, description, etc.)",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
    },
    async execute(input, ctx) {
      const { domain } = input as { domain: string };
      const data = await apiRequest(ctx, domain);
      return data.company;
    },
  });

  rl.registerAction("brand.getIndustry", {
    access: "read",
    description: "Get a company's industry classification",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
    },
    async execute(input, ctx) {
      const { domain } = input as { domain: string };
      return apiRequest(ctx, domain);
    },
  });
}
