import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { bannerbearCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const json =
    body && Object.keys(body).length > 0 && method !== "GET" ? body : undefined;
  return credentialJson(ctx, bannerbearCredential, "bannerbear", {
    target: "api",
    path,
    method,
    ...(json !== undefined ? { json } : {}),
  });
}

export default function bannerbear(rl: RunlinePluginAPI) {
  rl.setName("bannerbear");
  rl.setVersion("0.1.0");
  rl.setCredential(bannerbearCredential);

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

      const body: Record<string, unknown> = { template: templateId };
      if (modifications) body.modifications = modifications;
      if (webhookUrl) body.webhook_url = webhookUrl;
      if (metadata) body.metadata = metadata;

      let result = (await apiRequest(ctx, "POST", "images", body)) as Record<
        string,
        unknown
      >;

      if (waitForImage && result.status !== "completed") {
        let tries = maxTries as number;
        while (tries > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          result = (await apiRequest(
            ctx,
            "GET",
            `images/${seg(result.uid)}`,
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
      return apiRequest(ctx, "GET", `images/${seg(imageId)}`);
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
      return apiRequest(ctx, "GET", `templates/${seg(templateId)}`);
    },
  });

  rl.registerAction("template.list", {
    access: "read",
    description: "List all templates",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "templates");
    },
  });
}
