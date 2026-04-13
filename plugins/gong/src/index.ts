import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  accessKey: string,
  accessKeySecret: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${accessKey}:${accessKeySecret}`)}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Gong API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paginate(
  baseUrl: string,
  accessKey: string,
  accessKeySecret: string,
  endpoint: string,
  body: Record<string, unknown>,
  resultKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;
  do {
    const reqBody = { ...body };
    if (cursor) reqBody.cursor = cursor;
    const data = (await apiRequest(baseUrl, accessKey, accessKeySecret, "POST", endpoint, reqBody)) as Record<string, unknown>;
    const items = (data[resultKey] as unknown[]) ?? [];
    results.push(...items);
    cursor = (data.records as Record<string, unknown>)?.cursor as string | undefined;
    if (limit && results.length >= limit) break;
  } while (cursor);
  return limit ? results.slice(0, limit) : results;
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    baseUrl: ((ctx.connection.config.baseUrl as string) ?? "https://api.gong.io").replace(/\/$/, ""),
    accessKey: ctx.connection.config.accessKey as string,
    accessKeySecret: ctx.connection.config.accessKeySecret as string,
  };
}

export default function gong(rl: RunlinePluginAPI) {
  rl.setName("gong");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    baseUrl: { type: "string", required: false, description: "Gong API base URL (default: https://api.gong.io)", env: "GONG_BASE_URL", default: "https://api.gong.io" },
    accessKey: { type: "string", required: true, description: "Gong API access key", env: "GONG_ACCESS_KEY" },
    accessKeySecret: { type: "string", required: true, description: "Gong API access key secret", env: "GONG_ACCESS_KEY_SECRET" },
  });

  rl.registerAction("call.get", {
    description: "Get detailed call data",
    inputSchema: {
      callId: { type: "string", required: true, description: "Call ID" },
      contentSelector: { type: "object", required: false, description: "Content selector for what data to include (exposedFields object)" },
    },
    async execute(input, ctx) {
      const { callId, contentSelector } = input as Record<string, unknown>;
      const { baseUrl, accessKey, accessKeySecret } = getConn(ctx);
      const body: Record<string, unknown> = { filter: { callIds: [callId] } };
      if (contentSelector) body.contentSelector = contentSelector;
      const data = (await apiRequest(baseUrl, accessKey, accessKeySecret, "POST", "/v2/calls/extensive", body)) as Record<string, unknown>;
      const calls = data.calls as Array<Record<string, unknown>>;
      return calls?.[0];
    },
  });

  rl.registerAction("call.list", {
    description: "List calls",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      fromDateTime: { type: "string", required: false, description: "Calls started after (ISO 8601)" },
      toDateTime: { type: "string", required: false, description: "Calls started before (ISO 8601)" },
      workspaceId: { type: "string", required: false, description: "Filter by workspace" },
      callIds: { type: "array", required: false, description: "Specific call IDs" },
      primaryUserIds: { type: "array", required: false, description: "Filter by organizer user IDs" },
    },
    async execute(input, ctx) {
      const { limit, fromDateTime, toDateTime, workspaceId, callIds, primaryUserIds } = (input ?? {}) as Record<string, unknown>;
      const { baseUrl, accessKey, accessKeySecret } = getConn(ctx);
      const filter: Record<string, unknown> = {};
      if (fromDateTime) filter.fromDateTime = fromDateTime;
      if (toDateTime) filter.toDateTime = toDateTime;
      if (workspaceId) filter.workspaceId = workspaceId;
      if (callIds) filter.callIds = callIds;
      if (primaryUserIds) filter.primaryUserIds = primaryUserIds;
      return paginate(baseUrl, accessKey, accessKeySecret, "/v2/calls/extensive", { filter }, "calls", limit as number | undefined);
    },
  });

  rl.registerAction("user.get", {
    description: "Get a user",
    inputSchema: { userId: { type: "string", required: true, description: "User ID" } },
    async execute(input, ctx) {
      const { userId } = input as { userId: string };
      const { baseUrl, accessKey, accessKeySecret } = getConn(ctx);
      const data = (await apiRequest(baseUrl, accessKey, accessKeySecret, "POST", "/v2/users/extensive", {
        filter: { userIds: [userId] },
      })) as Record<string, unknown>;
      const users = data.users as Array<Record<string, unknown>>;
      return users?.[0];
    },
  });

  rl.registerAction("user.list", {
    description: "List users",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      createdFromDateTime: { type: "string", required: false, description: "Users created after (ISO 8601)" },
      createdToDateTime: { type: "string", required: false, description: "Users created before (ISO 8601)" },
      userIds: { type: "array", required: false, description: "Specific user IDs" },
    },
    async execute(input, ctx) {
      const { limit, createdFromDateTime, createdToDateTime, userIds } = (input ?? {}) as Record<string, unknown>;
      const { baseUrl, accessKey, accessKeySecret } = getConn(ctx);
      const filter: Record<string, unknown> = {};
      if (createdFromDateTime) filter.createdFromDateTime = createdFromDateTime;
      if (createdToDateTime) filter.createdToDateTime = createdToDateTime;
      if (userIds) filter.userIds = userIds;
      return paginate(baseUrl, accessKey, accessKeySecret, "/v2/users/extensive", { filter }, "users", limit as number | undefined);
    },
  });
}
