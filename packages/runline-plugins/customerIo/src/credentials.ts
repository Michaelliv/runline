import { staticCredential } from "../../_shared/credentials.js";

/**
 * The site ID and tracking key, sent as HTTP Basic to the Track API, and
 * the App API key, sent as a bearer to the App API — each on its own
 * target, in the US or EU region the connection names.
 */
export const customerIoCredential = staticCredential({
  id: "customerIo",
  auth: {
    kind: "static",
    parts: ["siteId", "trackingKey", "appKey"],
    placements: [
      {
        in: "basic",
        username: "siteId",
        password: "trackingKey",
        targets: ["track"],
      },
      {
        in: "header",
        part: "appKey",
        name: "Authorization",
        prefix: "Bearer ",
        targets: ["app"],
      },
    ],
  },
  local: {
    siteId: "siteId",
    trackingKey: "trackingApiKey",
    appKey: "appApiKey",
  },
  targets: (config) => {
    const eu = config.region === "track-eu.customer.io";
    return {
      track: {
        baseUrl: eu
          ? "https://track-eu.customer.io/api/v1/"
          : "https://track.customer.io/api/v1/",
        methods: ["POST", "PUT", "DELETE"],
      },
      app: {
        baseUrl: eu
          ? "https://api-eu.customer.io/v1/"
          : "https://api.customer.io/v1/",
        methods: ["GET"],
      },
    };
  },
});
