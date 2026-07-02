import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.openweathermap.org/data/2.5";

const locationSchema = {
  cityName: {
    type: "string" as const,
    required: false,
    description: "City name (e.g. berlin,de)",
  },
  cityId: {
    type: "number" as const,
    required: false,
    description: "City ID from OpenWeatherMap",
  },
  lat: { type: "string" as const, required: false, description: "Latitude" },
  lon: { type: "string" as const, required: false, description: "Longitude" },
  zip: {
    type: "string" as const,
    required: false,
    description: "Zip code (e.g. 10115,de)",
  },
  units: {
    type: "string" as const,
    required: false,
    description: "Units: metric (default), imperial, standard",
  },
  lang: {
    type: "string" as const,
    required: false,
    description: "Language code (e.g. en, de)",
  },
};

function buildQs(
  apiKey: string,
  input: Record<string, unknown>,
): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("APPID", apiKey);
  qs.set("units", (input.units as string) ?? "metric");
  if (input.cityName) qs.set("q", input.cityName as string);
  else if (input.cityId) qs.set("id", String(input.cityId));
  else if (input.lat && input.lon) {
    qs.set("lat", input.lat as string);
    qs.set("lon", input.lon as string);
  } else if (input.zip) qs.set("zip", input.zip as string);
  if (input.lang) qs.set("lang", input.lang as string);
  return qs;
}

export default function openWeatherMap(rl: RunlinePluginAPI) {
  rl.setName("openweathermap");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "OpenWeatherMap API key",
      env: "OPENWEATHERMAP_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  rl.registerAction("weather.current", {
    access: "read",
    description: "Get current weather data for a location",
    inputSchema: locationSchema,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs = buildQs(key(ctx), p);
      const res = await fetch(`${BASE}/weather?${qs.toString()}`);
      if (!res.ok)
        throw new Error(
          `OpenWeatherMap error ${res.status}: ${await res.text()}`,
        );
      return res.json();
    },
  });

  rl.registerAction("weather.forecast5day", {
    access: "read",
    description: "Get 5-day / 3-hour weather forecast for a location",
    inputSchema: locationSchema,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs = buildQs(key(ctx), p);
      const res = await fetch(`${BASE}/forecast?${qs.toString()}`);
      if (!res.ok)
        throw new Error(
          `OpenWeatherMap error ${res.status}: ${await res.text()}`,
        );
      return res.json();
    },
  });
}
