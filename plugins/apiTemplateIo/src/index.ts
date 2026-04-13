import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.apitemplate.io/v1";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  qs?: Record<string, unknown>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APITemplate.io error ${res.status}: ${text}`);
  }
  return res.json();
}

function getKey(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiKey as string;
}

export default function apiTemplateIo(rl: RunlinePluginAPI) {
  rl.setName("apiTemplateIo");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "APITemplate.io API key",
      env: "API_TEMPLATE_IO_API_KEY",
    },
  });

  rl.registerAction("account.get", {
    description: "Get account information",
    async execute(_input, ctx) {
      return apiRequest(getKey(ctx), "GET", "/account-information");
    },
  });

  rl.registerAction("template.list", {
    description: "List all templates",
    inputSchema: {
      format: { type: "string", required: false, description: "Filter by format: JPEG, PNG, or PDF" },
    },
    async execute(input, ctx) {
      const { format } = (input ?? {}) as { format?: string };
      const templates = (await apiRequest(getKey(ctx), "GET", "/list-templates")) as Array<Record<string, unknown>>;
      if (format) {
        return templates.filter((t) => t.format === format.toUpperCase());
      }
      return templates;
    },
  });

  rl.registerAction("image.create", {
    description: "Create an image from a template",
    inputSchema: {
      templateId: { type: "string", required: true, description: "Image template ID" },
      overrides: { type: "array", required: false, description: "Array of override objects with template field values" },
    },
    async execute(input, ctx) {
      const { templateId, overrides } = input as { templateId: string; overrides?: unknown[] };
      const body: Record<string, unknown> = {};
      if (overrides) body.overrides = overrides;
      return apiRequest(getKey(ctx), "POST", "/create", { template_id: templateId }, body);
    },
  });

  rl.registerAction("pdf.create", {
    description: "Create a PDF from a template",
    inputSchema: {
      templateId: { type: "string", required: true, description: "PDF template ID" },
      properties: { type: "object", required: true, description: "Template properties as key-value pairs" },
    },
    async execute(input, ctx) {
      const { templateId, properties } = input as {
        templateId: string;
        properties: Record<string, unknown>;
      };
      return apiRequest(getKey(ctx), "POST", "/create", { template_id: templateId }, properties);
    },
  });
}
