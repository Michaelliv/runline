import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.nasa.gov";

async function apiRequest(
  apiKey: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok)
    throw new Error(`NASA API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDate(d?: unknown): string | undefined {
  if (!d) return undefined;
  return String(d).split("T")[0];
}

export default function nasa(rl: RunlinePluginAPI) {
  rl.setName("nasa");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "NASA API key (get one at https://api.nasa.gov)",
      env: "NASA_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  rl.registerAction("apod.get", {
    access: "read",
    description:
      "Get the Astronomy Picture of the Day (returns metadata; image URL in 'hdurl' field)",
    inputSchema: {
      date: {
        type: "string",
        required: false,
        description: "Date (YYYY-MM-DD), defaults to today",
      },
    },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {
        date: formatDate((input as Record<string, unknown>)?.date) ?? today(),
      };
      return apiRequest(key(ctx), "/planetary/apod", qs);
    },
  });

  rl.registerAction("asteroidNeoFeed.get", {
    access: "read",
    description:
      "Get a list of asteroids based on closest approach date to Earth",
    inputSchema: {
      startDate: {
        type: "string",
        required: false,
        description: "Start date (YYYY-MM-DD), defaults to today",
      },
      endDate: {
        type: "string",
        required: false,
        description: "End date (YYYY-MM-DD), defaults to today",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        start_date: formatDate(p.startDate) ?? today(),
        end_date: formatDate(p.endDate) ?? today(),
      };
      const data = (await apiRequest(
        key(ctx),
        "/neo/rest/v1/feed",
        qs,
      )) as Record<string, unknown>;
      return data.near_earth_objects;
    },
  });

  rl.registerAction("asteroidNeoLookup.get", {
    access: "read",
    description: "Look up an asteroid by its NASA SPK-ID",
    inputSchema: {
      asteroidId: { type: "string", required: true },
      includeCloseApproachData: {
        type: "boolean",
        required: false,
        description: "Include close approach data (default false)",
      },
    },
    async execute(input, ctx) {
      const { asteroidId, includeCloseApproachData } = input as Record<
        string,
        unknown
      >;
      const data = (await apiRequest(
        key(ctx),
        `/neo/rest/v1/neo/${asteroidId}`,
      )) as Record<string, unknown>;
      if (!includeCloseApproachData) delete data.close_approach_data;
      return data;
    },
  });

  rl.registerAction("asteroidNeoBrowse.list", {
    access: "read",
    description: "Browse the overall asteroid dataset",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default 20)",
      },
    },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.size = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(
        key(ctx),
        "/neo/rest/v1/neo/browse",
        qs,
      )) as Record<string, unknown>;
      return data.near_earth_objects;
    },
  });

  // ── DONKI endpoints ─────────────────────────────────

  const donkiEndpoints: Array<{
    name: string;
    path: string;
    description: string;
  }> = [
    {
      name: "coronalMassEjection",
      path: "/DONKI/CME",
      description: "DONKI Coronal Mass Ejection data",
    },
    {
      name: "solarFlare",
      path: "/DONKI/FLR",
      description: "DONKI Solar Flare data",
    },
    {
      name: "solarEnergeticParticle",
      path: "/DONKI/SEP",
      description: "DONKI Solar Energetic Particle data",
    },
    {
      name: "magnetopauseCrossing",
      path: "/DONKI/MPC",
      description: "DONKI Magnetopause Crossing data",
    },
    {
      name: "radiationBeltEnhancement",
      path: "/DONKI/RBE",
      description: "DONKI Radiation Belt Enhancement data",
    },
    {
      name: "highSpeedStream",
      path: "/DONKI/HSS",
      description: "DONKI High Speed Stream data",
    },
    {
      name: "wsaEnlilSimulation",
      path: "/DONKI/WSAEnlilSimulations",
      description: "DONKI WSA+Enlil Simulation data",
    },
    {
      name: "notifications",
      path: "/DONKI/notifications",
      description: "DONKI Notifications data",
    },
  ];

  for (const ep of donkiEndpoints) {
    rl.registerAction(`donki.${ep.name}`, {
      access: "read",
      description: ep.description,
      inputSchema: {
        startDate: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD), defaults to 30 days ago",
        },
        endDate: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD), defaults to today",
        },
      },
      async execute(input, ctx) {
        const p = (input ?? {}) as Record<string, unknown>;
        const qs: Record<string, unknown> = {};
        if (p.startDate) qs.startDate = formatDate(p.startDate);
        if (p.endDate) qs.endDate = formatDate(p.endDate);
        return apiRequest(key(ctx), ep.path, qs);
      },
    });
  }

  rl.registerAction("donki.interplanetaryShock", {
    access: "read",
    description: "DONKI Interplanetary Shock data",
    inputSchema: {
      startDate: { type: "string", required: false },
      endDate: { type: "string", required: false },
      location: {
        type: "string",
        required: false,
        description: "ALL (default), earth, MESSENGER, STEREO A, STEREO B",
      },
      catalog: {
        type: "string",
        required: false,
        description:
          "ALL (default), SWRC_CATALOG, WINSLOW_MESSENGER_ICME_CATALOG",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.startDate) qs.startDate = formatDate(p.startDate);
      if (p.endDate) qs.endDate = formatDate(p.endDate);
      if (p.location) qs.location = p.location;
      if (p.catalog) qs.catalog = p.catalog;
      return apiRequest(key(ctx), "/DONKI/IPS", qs);
    },
  });

  // ── Earth ───────────────────────────────────────────

  rl.registerAction("earthAssets.get", {
    access: "read",
    description: "Get Earth asset metadata for a location",
    inputSchema: {
      lat: { type: "number", required: true, description: "Latitude" },
      lon: { type: "number", required: true, description: "Longitude" },
      date: {
        type: "string",
        required: false,
        description: "Date (YYYY-MM-DD)",
      },
      dim: {
        type: "number",
        required: false,
        description: "Width/height in degrees (default 0.025)",
      },
    },
    async execute(input, ctx) {
      const { lat, lon, date, dim } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { lat, lon, dim: dim ?? 0.025 };
      if (date) qs.date = formatDate(date);
      return apiRequest(key(ctx), "/planetary/earth/assets", qs);
    },
  });
}
