import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { philipsHueCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, philipsHueCredential, "philipsHue", {
    target: "api",
    path,
    method,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function philipsHue(rl: RunlinePluginAPI) {
  rl.setName("philipsHue");
  rl.setVersion("0.1.0");
  rl.setCredential(philipsHueCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Philips Hue OAuth2 access token",
      env: "PHILIPS_HUE_ACCESS_TOKEN",
    },
    username: {
      type: "string",
      required: true,
      description: "Bridge username (whitelisted user ID)",
      env: "PHILIPS_HUE_USERNAME",
    },
  });

  function user(ctx: ActionContext): string {
    return pathSegment(ctx.connection.config.username);
  }

  rl.registerAction("light.get", {
    access: "read",
    description: "Get a light by ID",
    inputSchema: { lightId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { lightId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `api/${user(ctx)}/lights/${pathSegment(lightId)}`,
      );
    },
  });

  rl.registerAction("light.list", {
    access: "read",
    description: "List all lights",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(
        ctx,
        "GET",
        `api/${user(ctx)}/lights`,
      )) as Record<string, unknown>;
      const lights = Object.entries(data).map(([id, v]) => ({
        id,
        ...(v as Record<string, unknown>),
      }));
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return lights.slice(0, limit as number);
      return lights;
    },
  });

  rl.registerAction("light.update", {
    access: "write",
    description: "Update a light's state (on/off, brightness, color, etc.)",
    inputSchema: {
      lightId: { type: "string", required: true },
      on: {
        type: "boolean",
        required: true,
        description: "Turn light on or off",
      },
      bri: {
        type: "number",
        required: false,
        description: "Brightness (1-254)",
      },
      hue: { type: "number", required: false, description: "Hue (0-65535)" },
      sat: {
        type: "number",
        required: false,
        description: "Saturation (0-254)",
      },
      ct: {
        type: "number",
        required: false,
        description: "Color temperature (153-500 mirek)",
      },
      xy: {
        type: "string",
        required: false,
        description: "CIE color as 'x,y' (e.g. 0.5,0.5)",
      },
      transitiontime: {
        type: "number",
        required: false,
        description: "Transition time in seconds",
      },
      alert: {
        type: "string",
        required: false,
        description: "none, select, or lselect",
      },
      effect: {
        type: "string",
        required: false,
        description: "none or colorloop",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { on: p.on };
      if (p.bri !== undefined) body.bri = p.bri;
      if (p.hue !== undefined) body.hue = p.hue;
      if (p.sat !== undefined) body.sat = p.sat;
      if (p.ct !== undefined) body.ct = p.ct;
      if (p.xy) body.xy = (p.xy as string).split(",").map(Number);
      if (p.transitiontime !== undefined)
        body.transitiontime = (p.transitiontime as number) * 100;
      if (p.alert) body.alert = p.alert;
      if (p.effect) body.effect = p.effect;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `api/${user(ctx)}/lights/${pathSegment(p.lightId)}/state`,
        body,
      )) as Array<Record<string, unknown>>;
      const result: Record<string, unknown> = {};
      for (const item of data) {
        if (item.success) Object.assign(result, item.success);
      }
      return result;
    },
  });

  rl.registerAction("light.delete", {
    access: "write",
    description: "Delete a light from the bridge",
    inputSchema: { lightId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { lightId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `api/${user(ctx)}/lights/${pathSegment(lightId)}`,
      );
    },
  });
}
