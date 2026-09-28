import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { openweathermapCredential } from "./credentials.js";

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

function buildQs(input: Record<string, unknown>): Record<string, unknown> {
  const qs: Record<string, unknown> = {
    units: (input.units as string) ?? "metric",
  };
  if (input.cityName) qs.q = input.cityName;
  else if (input.cityId) qs.id = String(input.cityId);
  else if (input.lat && input.lon) {
    qs.lat = input.lat;
    qs.lon = input.lon;
  } else if (input.zip) qs.zip = input.zip;
  if (input.lang) qs.lang = input.lang;
  return qs;
}

function apiRequest(
  ctx: ActionContext,
  path: string,
  query: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, openweathermapCredential, "openweathermap", {
    target: "api",
    path,
    query,
  });
}

export default function openWeatherMap(rl: RunlinePluginAPI) {
  rl.setName("openweathermap");
  rl.setVersion("0.1.0");
  rl.setCredential(openweathermapCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "OpenWeatherMap API key",
      env: "OPENWEATHERMAP_API_KEY",
    },
  });

  rl.registerAction("weather.current", {
    access: "read",
    description: "Get current weather data for a location",
    inputSchema: locationSchema,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return apiRequest(ctx, "weather", buildQs(p));
    },
  });

  rl.registerAction("weather.forecast5day", {
    access: "read",
    description: "Get 5-day / 3-hour weather forecast for a location",
    inputSchema: locationSchema,
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return apiRequest(ctx, "forecast", buildQs(p));
    },
  });
}
