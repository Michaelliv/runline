import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { humanticAiCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, humanticAiCredential, "humanticAi", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function humanticAi(rl: RunlinePluginAPI) {
  rl.setName("humanticAi");
  rl.setVersion("0.1.0");
  rl.setCredential(humanticAiCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Humantic AI API key",
      env: "HUMANTIC_AI_API_KEY",
    },
  });

  rl.registerAction("profile.create", {
    access: "write",
    description: "Create a user profile from LinkedIn URL or text",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "Unique user identifier",
      },
      linkedinUrl: {
        type: "string",
        required: false,
        description: "LinkedIn profile URL",
      },
      text: {
        type: "string",
        required: false,
        description: "Text content to analyze",
      },
    },
    async execute(input, ctx) {
      const { userId, linkedinUrl, text } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { userid: userId };
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      if (text) body.text = text;
      return apiRequest(ctx, "POST", "user-profile/create", body);
    },
  });

  rl.registerAction("profile.get", {
    access: "read",
    description: "Get a user profile/personality analysis",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "User identifier",
      },
      persona: {
        type: "string",
        required: false,
        description: "Persona type: sales, hiring, default",
      },
    },
    async execute(input, ctx) {
      const { userId, persona } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { userid: userId };
      if (persona) qs.persona = persona;
      return apiRequest(ctx, "GET", "user-profile", undefined, qs);
    },
  });

  rl.registerAction("profile.update", {
    access: "write",
    description: "Update a user profile with new data",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "User identifier",
      },
      text: { type: "string", required: false, description: "Additional text" },
      linkedinUrl: {
        type: "string",
        required: false,
        description: "LinkedIn URL",
      },
    },
    async execute(input, ctx) {
      const { userId, text, linkedinUrl } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { userid: userId };
      if (text) body.text = text;
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      return apiRequest(ctx, "POST", "user-profile/create", body);
    },
  });
}
