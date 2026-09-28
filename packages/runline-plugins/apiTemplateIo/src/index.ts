import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { apiTemplateIoCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  query?: Record<string, unknown>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, apiTemplateIoCredential, "apiTemplateIo", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function apiTemplateIo(rl: RunlinePluginAPI) {
  rl.setName("apiTemplateIo");
  rl.setVersion("0.1.0");
  rl.setCredential(apiTemplateIoCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "APITemplate.io API key",
      env: "API_TEMPLATE_IO_API_KEY",
    },
  });

  rl.registerAction("account.get", {
    access: "read",
    description: "Get account information",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "account-information");
    },
  });

  rl.registerAction("template.list", {
    access: "read",
    description: "List all templates",
    inputSchema: {
      format: {
        type: "string",
        required: false,
        description: "Filter by format: JPEG, PNG, or PDF",
      },
    },
    async execute(input, ctx) {
      const { format } = (input ?? {}) as { format?: string };
      const templates = (await apiRequest(
        ctx,
        "GET",
        "list-templates",
      )) as Array<Record<string, unknown>>;
      if (format) {
        return templates.filter((t) => t.format === format.toUpperCase());
      }
      return templates;
    },
  });

  rl.registerAction("image.create", {
    access: "write",
    description: "Create an image from a template",
    inputSchema: {
      templateId: {
        type: "string",
        required: true,
        description: "Image template ID",
      },
      overrides: {
        type: "array",
        required: false,
        description: "Array of override objects with template field values",
      },
    },
    async execute(input, ctx) {
      const { templateId, overrides } = input as {
        templateId: string;
        overrides?: unknown[];
      };
      const body: Record<string, unknown> = {};
      if (overrides) body.overrides = overrides;
      return apiRequest(
        ctx,
        "POST",
        "create",
        { template_id: templateId },
        body,
      );
    },
  });

  rl.registerAction("pdf.create", {
    access: "write",
    description: "Create a PDF from a template",
    inputSchema: {
      templateId: {
        type: "string",
        required: true,
        description: "PDF template ID",
      },
      properties: {
        type: "object",
        required: true,
        description: "Template properties as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { templateId, properties } = input as {
        templateId: string;
        properties: Record<string, unknown>;
      };
      return apiRequest(
        ctx,
        "POST",
        "create",
        { template_id: templateId },
        properties,
      );
    },
  });
}
