import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, appended by the transport as the api_key query parameter on
 * NASA's one API origin.
 */
export const nasaCredential = staticCredential({
  id: "nasa",
  auth: { kind: "queryKey", param: "api_key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.nasa.gov/",
      methods: ["GET"],
    },
  },
  probe: {
    target: "api",
    path: "planetary/apod",
    method: "GET",
    acceptedStatuses: [200],
  },
});
