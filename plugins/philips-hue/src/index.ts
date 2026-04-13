import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.meethue.com/route";

async function apiRequest(
  accessToken: string, method: string, path: string, body?: Record<string, unknown>,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`Philips Hue error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function philipsHue(rl: RunlinePluginAPI) {
  rl.setName("philips-hue");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Philips Hue OAuth2 access token", env: "PHILIPS_HUE_ACCESS_TOKEN" },
    username: { type: "string", required: true, description: "Bridge username (whitelisted user ID)", env: "PHILIPS_HUE_USERNAME" },
  });

  function conn(ctx: { connection: { config: Record<string, unknown> } }) {
    return { token: ctx.connection.config.accessToken as string, user: ctx.connection.config.username as string };
  }

  rl.registerAction("light.get", {
    description: "Get a light by ID",
    inputSchema: { lightId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { lightId } = input as Record<string, unknown>;
      const c = conn(ctx);
      return apiRequest(c.token, "GET", `/api/${c.user}/lights/${lightId}`);
    },
  });

  rl.registerAction("light.list", {
    description: "List all lights",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const c = conn(ctx);
      const data = (await apiRequest(c.token, "GET", `/api/${c.user}/lights`)) as Record<string, unknown>;
      const lights = Object.entries(data).map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return lights.slice(0, limit as number);
      return lights;
    },
  });

  rl.registerAction("light.update", {
    description: "Update a light's state (on/off, brightness, color, etc.)",
    inputSchema: {
      lightId: { type: "string", required: true },
      on: { type: "boolean", required: true, description: "Turn light on or off" },
      bri: { type: "number", required: false, description: "Brightness (1-254)" },
      hue: { type: "number", required: false, description: "Hue (0-65535)" },
      sat: { type: "number", required: false, description: "Saturation (0-254)" },
      ct: { type: "number", required: false, description: "Color temperature (153-500 mirek)" },
      xy: { type: "string", required: false, description: "CIE color as 'x,y' (e.g. 0.5,0.5)" },
      transitiontime: { type: "number", required: false, description: "Transition time in seconds" },
      alert: { type: "string", required: false, description: "none, select, or lselect" },
      effect: { type: "string", required: false, description: "none or colorloop" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const c = conn(ctx);
      const body: Record<string, unknown> = { on: p.on };
      if (p.bri !== undefined) body.bri = p.bri;
      if (p.hue !== undefined) body.hue = p.hue;
      if (p.sat !== undefined) body.sat = p.sat;
      if (p.ct !== undefined) body.ct = p.ct;
      if (p.xy) body.xy = (p.xy as string).split(",").map(Number);
      if (p.transitiontime !== undefined) body.transitiontime = (p.transitiontime as number) * 100;
      if (p.alert) body.alert = p.alert;
      if (p.effect) body.effect = p.effect;
      const data = (await apiRequest(c.token, "PUT", `/api/${c.user}/lights/${p.lightId}/state`, body)) as Array<Record<string, unknown>>;
      const result: Record<string, unknown> = {};
      for (const item of data) { if (item.success) Object.assign(result, item.success); }
      return result;
    },
  });

  rl.registerAction("light.delete", {
    description: "Delete a light from the bridge",
    inputSchema: { lightId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { lightId } = input as Record<string, unknown>;
      const c = conn(ctx);
      return apiRequest(c.token, "DELETE", `/api/${c.user}/lights/${lightId}`);
    },
  });
}
