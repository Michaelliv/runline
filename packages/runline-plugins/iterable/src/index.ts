import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { iterableCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const json =
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? body
      : undefined;
  return credentialJson(ctx, iterableCredential, "iterable", {
    target: "api",
    path,
    method,
    query: qs,
    ...(json !== undefined ? { json } : {}),
  });
}

export default function iterable(rl: RunlinePluginAPI) {
  rl.setName("iterable");
  rl.setVersion("0.1.0");
  rl.setCredential(iterableCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Iterable API key",
      env: "ITERABLE_API_KEY",
    },
    region: {
      type: "string",
      required: false,
      description: "API base URL (default: https://api.iterable.com)",
      env: "ITERABLE_REGION",
      default: "https://api.iterable.com",
    },
  });

  // ── Event ───────────────────────────────────────────
  rl.registerAction("event.track", {
    access: "write",
    description:
      "Track events for users (bulk). Each event requires email or userId, plus eventName.",
    inputSchema: {
      events: {
        type: "array",
        required: true,
        description:
          "Array of event objects. Each needs: eventName (string, required), email or id (string, one required), dataFields (object, optional), createdAt (unix timestamp, optional)",
      },
    },
    async execute(input, ctx) {
      const { events } = input as { events: Record<string, unknown>[] };
      return apiRequest(ctx, "POST", "events/trackBulk", { events });
    },
  });

  // ── User ────────────────────────────────────────────
  rl.registerAction("user.upsert", {
    access: "write",
    description: "Create or update a user",
    inputSchema: {
      identifier: {
        type: "string",
        required: true,
        description: "'email' or 'userId'",
      },
      value: {
        type: "string",
        required: true,
        description: "The email address or userId value",
      },
      preferUserId: {
        type: "boolean",
        required: false,
        description:
          "When identifier is userId, prefer userId for lookups (default false)",
      },
      dataFields: {
        type: "object",
        required: false,
        description: "User data fields as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { identifier, value, preferUserId, dataFields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (identifier === "email") {
        body.email = value;
      } else {
        body.userId = value;
        if (preferUserId !== undefined) body.preferUserId = preferUserId;
      }
      if (dataFields) body.dataFields = dataFields;
      return apiRequest(ctx, "POST", "users/update", body);
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by email or userId",
    inputSchema: {
      by: {
        type: "string",
        required: true,
        description: "'email' or 'userId'",
      },
      value: {
        type: "string",
        required: true,
        description: "The email address or userId",
      },
    },
    async execute(input, ctx) {
      const { by, value } = input as Record<string, unknown>;
      if (by === "email") {
        const data = await apiRequest(
          ctx,
          "GET",
          "users/getByEmail",
          undefined,
          {
            email: value as string,
          },
        );
        return (data as Record<string, unknown>).user ?? data;
      }
      return apiRequest(ctx, "GET", `users/byUserId/${pathSegment(value)}`);
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete a user by email or userId",
    inputSchema: {
      by: {
        type: "string",
        required: true,
        description: "'email' or 'userId'",
      },
      value: {
        type: "string",
        required: true,
        description: "The email address or userId",
      },
    },
    async execute(input, ctx) {
      const { by, value } = input as Record<string, unknown>;
      const endpoint =
        by === "email"
          ? `users/${pathSegment(value)}`
          : `users/byUserId/${pathSegment(value)}`;
      return apiRequest(ctx, "DELETE", endpoint);
    },
  });

  // ── User List ───────────────────────────────────────
  rl.registerAction("userList.add", {
    access: "write",
    description: "Subscribe users to a list",
    inputSchema: {
      listId: { type: "number", required: true, description: "List ID" },
      identifier: {
        type: "string",
        required: true,
        description: "'email' or 'userId'",
      },
      values: {
        type: "array",
        required: true,
        description: "Array of email addresses or userIds to subscribe",
      },
    },
    async execute(input, ctx) {
      const { listId, identifier, values } = input as Record<string, unknown>;
      const subscribers = (values as string[]).map((v) =>
        identifier === "email" ? { email: v } : { userId: v },
      );
      return apiRequest(ctx, "POST", "lists/subscribe", {
        listId,
        subscribers,
      });
    },
  });

  rl.registerAction("userList.remove", {
    access: "write",
    description: "Unsubscribe users from a list",
    inputSchema: {
      listId: { type: "number", required: true, description: "List ID" },
      identifier: {
        type: "string",
        required: true,
        description: "'email' or 'userId'",
      },
      values: {
        type: "array",
        required: true,
        description: "Array of email addresses or userIds to unsubscribe",
      },
      campaignId: {
        type: "number",
        required: false,
        description: "Campaign ID for attribution",
      },
      channelUnsubscribe: {
        type: "boolean",
        required: false,
        description: "Unsubscribe from channel",
      },
    },
    async execute(input, ctx) {
      const { listId, identifier, values, campaignId, channelUnsubscribe } =
        input as Record<string, unknown>;
      const subscribers = (values as string[]).map((v) =>
        identifier === "email" ? { email: v } : { userId: v },
      );
      const body: Record<string, unknown> = { listId, subscribers };
      if (campaignId !== undefined) body.campaignId = campaignId;
      if (channelUnsubscribe !== undefined)
        body.channelUnsubscribe = channelUnsubscribe;
      return apiRequest(ctx, "POST", "lists/unsubscribe", body);
    },
  });
}
