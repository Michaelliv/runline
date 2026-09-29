import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { veroCredential } from "./credentials.js";

/** A Vero form call; object values travel JSON-encoded. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, veroCredential, "vero", {
    target: "api",
    path: endpoint,
    method,
    form: Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        value && typeof value === "object" ? JSON.stringify(value) : value,
      ]),
    ),
  });
}

export default function vero(rl: RunlinePluginAPI) {
  rl.setName("vero");
  rl.setVersion("0.1.0");
  rl.setCredential(veroCredential);

  rl.setConnectionSchema({
    authToken: {
      type: "string",
      required: true,
      description: "Vero auth token",
      env: "VERO_AUTH_TOKEN",
    },
  });

  rl.registerAction("user.create", {
    access: "write",
    description: "Create/identify a user",
    inputSchema: {
      id: { type: "string", required: true },
      email: { type: "string", required: false },
      data: {
        type: "object",
        required: false,
        description: "Custom attributes",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id: p.id };
      if (p.email) body.email = p.email;
      if (p.data) body.data = p.data;
      return apiRequest(ctx, "POST", "users/track", body);
    },
  });

  rl.registerAction("user.alias", {
    access: "write",
    description: "Alias (re-identify) a user",
    inputSchema: {
      id: { type: "string", required: true },
      newId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", "users/reidentify", {
        id: p.id,
        new_id: p.newId,
      });
    },
  });

  for (const op of ["unsubscribe", "resubscribe", "delete"] as const) {
    rl.registerAction(`user.${op}`, {
      access: "write",
      description: `${op.charAt(0).toUpperCase() + op.slice(1)} a user`,
      inputSchema: { id: { type: "string", required: true } },
      async execute(input, ctx) {
        return apiRequest(ctx, "POST", `users/${op}`, {
          id: (input as Record<string, unknown>).id,
        });
      },
    });
  }

  rl.registerAction("user.addTags", {
    access: "write",
    description: "Add tags to a user",
    inputSchema: {
      id: { type: "string", required: true },
      tags: {
        type: "string",
        required: true,
        description: "Comma-separated tags",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", "users/tags/edit", {
        id: p.id,
        add: JSON.stringify((p.tags as string).split(",").map((t) => t.trim())),
      });
    },
  });

  rl.registerAction("user.removeTags", {
    access: "write",
    description: "Remove tags from a user",
    inputSchema: {
      id: { type: "string", required: true },
      tags: {
        type: "string",
        required: true,
        description: "Comma-separated tags",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", "users/tags/edit", {
        id: p.id,
        remove: JSON.stringify(
          (p.tags as string).split(",").map((t) => t.trim()),
        ),
      });
    },
  });

  rl.registerAction("event.track", {
    access: "write",
    description: "Track an event",
    inputSchema: {
      id: { type: "string", required: true },
      email: { type: "string", required: true },
      eventName: { type: "string", required: true },
      data: { type: "object", required: false },
      extras: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        identity: { id: p.id, email: p.email },
        event_name: p.eventName,
        email: p.email,
      };
      if (p.data) body.data = JSON.stringify(p.data);
      if (p.extras) body.extras = JSON.stringify(p.extras);
      return apiRequest(ctx, "POST", "events/track", body);
    },
  });
}
