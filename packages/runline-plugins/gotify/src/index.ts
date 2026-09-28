import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { gotifyCredential } from "./credentials.js";

/** A Gotify call on the app target (sending) or the client target (reading, deleting). */
function apiRequest(
  ctx: ActionContext,
  target: "app" | "client",
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, gotifyCredential, "gotify", {
    target,
    path,
    method,
    query,
    json: body,
  });
}

export default function gotify(rl: RunlinePluginAPI) {
  rl.setName("gotify");
  rl.setVersion("0.1.0");
  rl.setCredential(gotifyCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Gotify server URL (e.g. https://gotify.example.com)",
      env: "GOTIFY_URL",
    },
    appApiToken: {
      type: "string",
      required: true,
      description: "Application token (for sending messages)",
      env: "GOTIFY_APP_TOKEN",
    },
    clientApiToken: {
      type: "string",
      required: true,
      description: "Client token (for reading/deleting)",
      env: "GOTIFY_CLIENT_TOKEN",
    },
  });

  rl.registerAction("message.create", {
    access: "write",
    description: "Send a push message",
    inputSchema: {
      message: { type: "string", required: true, description: "Message text" },
      title: { type: "string", required: false, description: "Message title" },
      priority: {
        type: "number",
        required: false,
        description: "Priority (default: 1)",
      },
      contentType: {
        type: "string",
        required: false,
        description: "text/plain (default) or text/markdown",
      },
    },
    async execute(input, ctx) {
      const { message, title, priority, contentType } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { message };
      if (title) body.title = title;
      if (priority !== undefined) body.priority = priority;
      if (contentType) body.extras = { "client::display": { contentType } };
      return apiRequest(ctx, "app", "POST", "message", body);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: {
      messageId: { type: "string", required: true, description: "Message ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "client",
        "DELETE",
        `message/${pathSegment((input as { messageId: string }).messageId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description: "List messages",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      const data = (await apiRequest(
        ctx,
        "client",
        "GET",
        "message",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.messages;
    },
  });
}
