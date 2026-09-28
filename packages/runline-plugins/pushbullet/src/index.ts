import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { pushbulletCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, pushbulletCredential, "pushbullet", {
    target: "api",
    path: path.replace(/^\//, ""),
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | undefined;
  do {
    if (cursor) qs.cursor = cursor;
    const data = (await apiRequest(ctx, "GET", path, undefined, qs)) as Record<
      string,
      unknown
    >;
    const items = (data.pushes ?? []) as unknown[];
    all.push(...items);
    cursor = data.cursor as string | undefined;
  } while (cursor);
  return all;
}

export default function pushbullet(rl: RunlinePluginAPI) {
  rl.setName("pushbullet");
  rl.setVersion("0.1.0");
  rl.setCredential(pushbulletCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Pushbullet Access Token",
      env: "PUSHBULLET_ACCESS_TOKEN",
    },
  });

  rl.registerAction("push.create", {
    access: "write",
    description: "Create a push (note or link)",
    inputSchema: {
      type: { type: "string", required: true, description: "note or link" },
      title: { type: "string", required: true },
      body: { type: "string", required: true },
      url: {
        type: "string",
        required: false,
        description: "URL (required for link type)",
      },
      target: {
        type: "string",
        required: false,
        description: "Target: default, device_iden, email, channel_tag",
      },
      targetValue: {
        type: "string",
        required: false,
        description: "Value for target (device ID, email, or channel tag)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const reqBody: Record<string, unknown> = {
        type: p.type,
        title: p.title,
        body: p.body,
      };
      if (p.type === "link" && p.url) reqBody.url = p.url;
      const target = (p.target as string) ?? "default";
      if (target !== "default" && p.targetValue)
        reqBody[target] = p.targetValue;
      return apiRequest(ctx, "POST", "/pushes", reqBody);
    },
  });

  rl.registerAction("push.list", {
    access: "read",
    description: "List pushes",
    inputSchema: {
      limit: { type: "number", required: false },
      active: {
        type: "boolean",
        required: false,
        description: "Only return non-deleted pushes",
      },
      modifiedAfter: {
        type: "string",
        required: false,
        description: "ISO timestamp — only return pushes modified after this",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.active) qs.active = "true";
      if (p.modifiedAfter)
        qs.modified_after = String(
          Math.floor(new Date(p.modifiedAfter as string).getTime() / 1000),
        );
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          ctx,
          "GET",
          "/pushes",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.pushes;
      }
      return paginate(ctx, "/pushes", qs);
    },
  });

  rl.registerAction("push.delete", {
    access: "write",
    description: "Delete a push",
    inputSchema: { pushId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { pushId } = input as Record<string, unknown>;
      await apiRequest(ctx, "DELETE", `/pushes/${seg(pushId)}`);
      return { success: true };
    },
  });

  rl.registerAction("push.update", {
    access: "write",
    description: "Update a push (dismiss it)",
    inputSchema: {
      pushId: { type: "string", required: true },
      dismissed: {
        type: "boolean",
        required: true,
        description: "Mark push as dismissed",
      },
    },
    async execute(input, ctx) {
      const { pushId, dismissed } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `/pushes/${seg(pushId)}`, { dismissed });
    },
  });
}
