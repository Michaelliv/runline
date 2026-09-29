import { configChoice, staticCredential } from "../../_shared/credentials.js";

/** The Track and App API bases of each region, keyed by its Track host. */
const REGIONS = {
  "track.customer.io": {
    track: "https://track.customer.io/api/v1/",
    app: "https://api.customer.io/v1/",
  },
  "track-eu.customer.io": {
    track: "https://track-eu.customer.io/api/v1/",
    app: "https://api-eu.customer.io/v1/",
  },
} as const;

/**
 * The site ID and tracking key, sent as HTTP Basic to the Track API, and
 * the App API key, sent as a bearer to the App API — each on its own
 * target, in the region the connection names (US when absent). An unknown
 * region is refused, never sent to another region's hosts.
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
    const bases =
      REGIONS[
        configChoice(
          config.region,
          ["track.customer.io", "track-eu.customer.io"],
          "track.customer.io",
        )
      ];
    return {
      track: { baseUrl: bases.track, methods: ["POST", "PUT", "DELETE"] },
      app: { baseUrl: bases.app, methods: ["GET"] },
    };
  },
});
