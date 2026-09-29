import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { peekalinkCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, peekalinkCredential, "peekalink", {
    target: "api",
    path,
    method: "POST",
    json: body,
  });
}

export default function peekalink(rl: RunlinePluginAPI) {
  rl.setName("peekalink");
  rl.setVersion("0.1.0");
  rl.setCredential(peekalinkCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Peekalink API key",
      env: "PEEKALINK_API_KEY",
    },
  });

  rl.registerAction("link.preview", {
    access: "read",
    description: "Get a rich preview for a URL",
    inputSchema: {
      url: { type: "string", required: true, description: "URL to preview" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(ctx, "", { link: url });
    },
  });

  rl.registerAction("link.isAvailable", {
    access: "read",
    description: "Check whether a preview is available for a URL",
    inputSchema: {
      url: { type: "string", required: true, description: "URL to check" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(ctx, "is-available/", { link: url });
    },
  });
}
