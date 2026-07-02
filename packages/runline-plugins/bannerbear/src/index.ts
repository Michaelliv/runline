import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.bannerbear.com/v2";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bannerbear API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function bannerbear(rl: RunlinePluginAPI) {
  rl.setName("bannerbear");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Bannerbear API key",
      env: "BANNERBEAR_API_KEY",
    },
  });

  // ── Image ───────────────────────────────────────────

  rl.registerAction("image.create", {
    access: "write",
    description: "Create an image from a template",
    inputSchema: {
      templateId: {
        type: "string",
        required: true,
        description: "Template UID",
      },
      modifications: {
        type: "array",
        required: false,
        description:
          "Array of modification objects (name, text, color, image_url, etc.)",
      },
      webhookUrl: {
        type: "string",
        required: false,
        description: "Webhook URL to notify on completion",
      },
      metadata: {
        type: "string",
        required: false,
        description: "Custom metadata string",
      },
      waitForImage: {
        type: "boolean",
        required: false,
        description:
          "Wait for image to finish processing (polls until complete)",
      },
      maxTries: {
        type: "number",
        required: false,
        description: "Max poll attempts when waiting (default: 3)",
      },
    },
    async execute(input, ctx) {
      const {
        templateId,
        modifications,
        webhookUrl,
        metadata,
        waitForImage,
        maxTries = 3,
      } = (input ?? {}) as Record<string, unknown>;
      const apiKey = getKey(ctx);

      const body: Record<string, unknown> = { template: templateId };
      if (modifications) body.modifications = modifications;
      if (webhookUrl) body.webhook_url = webhookUrl;
      if (metadata) body.metadata = metadata;

      let result = (await apiRequest(
        apiKey,
        "POST",
        "/images",
        body,
      )) as Record<string, unknown>;

      if (waitForImage && result.status !== "completed") {
        let tries = maxTries as number;
        while (tries > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          result = (await apiRequest(
            apiKey,
            "GET",
            `/images/${result.uid}`,
          )) as Record<string, unknown>;
          if (result.status === "completed") break;
          tries--;
        }
        if (result.status !== "completed") {
          throw new Error(
            "Image did not finish processing after multiple tries",
          );
        }
      }

      return result;
    },
  });

  rl.registerAction("image.get", {
    access: "read",
    description: "Get an image by ID",
    inputSchema: {
      imageId: { type: "string", required: true, description: "Image UID" },
    },
    async execute(input, ctx) {
      const { imageId } = input as { imageId: string };
      return apiRequest(getKey(ctx), "GET", `/images/${imageId}`);
    },
  });

  // ── Template ────────────────────────────────────────

  rl.registerAction("template.get", {
    access: "read",
    description: "Get a template by ID",
    inputSchema: {
      templateId: {
        type: "string",
        required: true,
        description: "Template UID",
      },
    },
    async execute(input, ctx) {
      const { templateId } = input as { templateId: string };
      return apiRequest(getKey(ctx), "GET", `/templates/${templateId}`);
    },
  });

  rl.registerAction("template.list", {
    access: "read",
    description: "List all templates",
    async execute(_input, ctx) {
      return apiRequest(getKey(ctx), "GET", "/templates");
    },
  });
}
