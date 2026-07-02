import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.brandfetch.io/v2";

async function apiRequest(
  apiKey: string,
  domain: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/brands/${domain}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brandfetch API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function brandfetch(rl: RunlinePluginAPI) {
  rl.setName("brandfetch");
  rl.setVersion("0.1.0");

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
      const data = await apiRequest(getKey(ctx), domain);
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
      const data = await apiRequest(getKey(ctx), domain);
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
      const data = await apiRequest(getKey(ctx), domain);
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
      const data = await apiRequest(getKey(ctx), domain);
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
      return apiRequest(getKey(ctx), domain);
    },
  });
}
