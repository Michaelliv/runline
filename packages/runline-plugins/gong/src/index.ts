import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { gongCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, gongCredential, "gong", {
    target: "api",
    path,
    method: "POST",
    json: body,
  });
}

async function paginate(
  ctx: ActionContext,
  path: string,
  body: Record<string, unknown>,
  resultKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;
  do {
    const reqBody = { ...body };
    if (cursor) reqBody.cursor = cursor;
    const data = (await api(ctx, path, reqBody)) as Record<string, unknown>;
    const items = (data[resultKey] as unknown[]) ?? [];
    results.push(...items);
    cursor = (data.records as Record<string, unknown>)?.cursor as
      | string
      | undefined;
    if (limit && results.length >= limit) break;
  } while (cursor);
  return limit ? results.slice(0, limit) : results;
}

export default function gong(rl: RunlinePluginAPI) {
  rl.setName("gong");
  rl.setVersion("0.1.0");
  rl.setCredential(gongCredential);

  rl.setConnectionSchema({
    baseUrl: {
      type: "string",
      required: false,
      description: "Gong API base URL (default: https://api.gong.io)",
      env: "GONG_BASE_URL",
      default: "https://api.gong.io",
    },
    accessKey: {
      type: "string",
      required: true,
      description: "Gong API access key",
      env: "GONG_ACCESS_KEY",
    },
    accessKeySecret: {
      type: "string",
      required: true,
      description: "Gong API access key secret",
      env: "GONG_ACCESS_KEY_SECRET",
    },
  });

  rl.registerAction("call.get", {
    access: "read",
    description: "Get detailed call data",
    inputSchema: {
      callId: { type: "string", required: true, description: "Call ID" },
      contentSelector: {
        type: "object",
        required: false,
        description:
          "Content selector for what data to include (exposedFields object)",
      },
    },
    async execute(input, ctx) {
      const { callId, contentSelector } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { filter: { callIds: [callId] } };
      if (contentSelector) body.contentSelector = contentSelector;
      const data = (await api(ctx, "calls/extensive", body)) as Record<
        string,
        unknown
      >;
      const calls = data.calls as Array<Record<string, unknown>>;
      return calls?.[0];
    },
  });

  rl.registerAction("call.list", {
    access: "read",
    description: "List calls",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      fromDateTime: {
        type: "string",
        required: false,
        description: "Calls started after (ISO 8601)",
      },
      toDateTime: {
        type: "string",
        required: false,
        description: "Calls started before (ISO 8601)",
      },
      workspaceId: {
        type: "string",
        required: false,
        description: "Filter by workspace",
      },
      callIds: {
        type: "array",
        required: false,
        description: "Specific call IDs",
      },
      primaryUserIds: {
        type: "array",
        required: false,
        description: "Filter by organizer user IDs",
      },
    },
    async execute(input, ctx) {
      const {
        limit,
        fromDateTime,
        toDateTime,
        workspaceId,
        callIds,
        primaryUserIds,
      } = (input ?? {}) as Record<string, unknown>;
      const filter: Record<string, unknown> = {};
      if (fromDateTime) filter.fromDateTime = fromDateTime;
      if (toDateTime) filter.toDateTime = toDateTime;
      if (workspaceId) filter.workspaceId = workspaceId;
      if (callIds) filter.callIds = callIds;
      if (primaryUserIds) filter.primaryUserIds = primaryUserIds;
      return paginate(
        ctx,
        "calls/extensive",
        { filter },
        "calls",
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
    },
    async execute(input, ctx) {
      const { userId } = input as { userId: string };
      const data = (await api(ctx, "users/extensive", {
        filter: { userIds: [userId] },
      })) as Record<string, unknown>;
      const users = data.users as Array<Record<string, unknown>>;
      return users?.[0];
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      createdFromDateTime: {
        type: "string",
        required: false,
        description: "Users created after (ISO 8601)",
      },
      createdToDateTime: {
        type: "string",
        required: false,
        description: "Users created before (ISO 8601)",
      },
      userIds: {
        type: "array",
        required: false,
        description: "Specific user IDs",
      },
    },
    async execute(input, ctx) {
      const { limit, createdFromDateTime, createdToDateTime, userIds } =
        (input ?? {}) as Record<string, unknown>;
      const filter: Record<string, unknown> = {};
      if (createdFromDateTime) filter.createdFromDateTime = createdFromDateTime;
      if (createdToDateTime) filter.createdToDateTime = createdToDateTime;
      if (userIds) filter.userIds = userIds;
      return paginate(
        ctx,
        "users/extensive",
        { filter },
        "users",
        limit as number | undefined,
      );
    },
  });
}
