import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { posthogCredential } from "./credentials.js";

/** Every PostHog capture call is a JSON POST. */
function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, posthogCredential, "posthog", {
    target: "api",
    path: endpoint,
    method: "POST",
    json: body,
  });
}

export default function posthog(rl: RunlinePluginAPI) {
  rl.setName("posthog");
  rl.setVersion("0.1.0");
  rl.setCredential(posthogCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "PostHog instance URL (e.g. https://app.posthog.com)",
      env: "POSTHOG_URL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "PostHog project API key",
      env: "POSTHOG_API_KEY",
    },
  });

  rl.registerAction("alias.create", {
    access: "write",
    description: "Create an alias for a distinct ID",
    inputSchema: {
      distinctId: { type: "string", required: true },
      alias: { type: "string", required: true },
      context: {
        type: "object",
        required: false,
        description: "Context key-value pairs",
      },
      timestamp: {
        type: "string",
        required: false,
        description: "ISO 8601 timestamp",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        type: "alias",
        event: "$create_alias",
        context: p.context ?? {},
        properties: { distinct_id: p.distinctId, alias: p.alias },
      };
      if (p.timestamp) body.timestamp = p.timestamp;
      return apiRequest(ctx, "batch", body);
    },
  });

  rl.registerAction("event.create", {
    access: "write",
    description: "Capture one or more events",
    inputSchema: {
      events: {
        type: "object",
        required: true,
        description:
          "Array of event objects: [{event, distinct_id, properties?, timestamp?}]",
      },
    },
    async execute(input, ctx) {
      const { events } = input as Record<string, unknown>;
      return apiRequest(ctx, "capture", { batch: events });
    },
  });

  rl.registerAction("identity.create", {
    access: "write",
    description: "Identify a user (set person properties)",
    inputSchema: {
      distinctId: { type: "string", required: true },
      properties: {
        type: "object",
        required: false,
        description: "Person properties to set",
      },
      timestamp: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        event: "$identify",
        distinct_id: p.distinctId,
        properties: p.properties ?? {},
      };
      if (p.timestamp) body.timestamp = p.timestamp;
      return apiRequest(ctx, "batch", body);
    },
  });

  rl.registerAction("track.page", {
    access: "write",
    description: "Track a page view",
    inputSchema: {
      distinctId: { type: "string", required: true },
      name: { type: "string", required: true, description: "Page name" },
      properties: { type: "object", required: false },
      context: { type: "object", required: false },
      timestamp: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        type: "page",
        event: "$page",
        name: p.name,
        distinct_id: p.distinctId,
        properties: p.properties ?? {},
        context: p.context ?? {},
      };
      if (p.timestamp) body.timestamp = p.timestamp;
      return apiRequest(ctx, "batch", body);
    },
  });

  rl.registerAction("track.screen", {
    access: "write",
    description: "Track a screen view",
    inputSchema: {
      distinctId: { type: "string", required: true },
      name: { type: "string", required: true, description: "Screen name" },
      properties: { type: "object", required: false },
      context: { type: "object", required: false },
      timestamp: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        type: "screen",
        event: "$screen",
        name: p.name,
        distinct_id: p.distinctId,
        properties: p.properties ?? {},
        context: p.context ?? {},
      };
      if (p.timestamp) body.timestamp = p.timestamp;
      return apiRequest(ctx, "batch", body);
    },
  });
}
