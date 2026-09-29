import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, appended by the transport as the APPID query parameter on
 * OpenWeatherMap's data API.
 */
export const openweathermapCredential = staticCredential({
  id: "openweathermap",
  auth: { kind: "queryKey", param: "APPID" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.openweathermap.org/data/2.5/",
      methods: ["GET"],
    },
  },
});
