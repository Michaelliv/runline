import { AuthError } from "runline";
import { staticCredential } from "../../_shared/credentials.js";

/** The Track and App API bases of each region, keyed by its Track host. */
const REGIONS: Record<string, { track: string; app: string }> = {
  "track.customer.io": {
    track: "https://track.customer.io/api/v1/",
    app: "https://api.customer.io/v1/",
  },
  "track-eu.customer.io": {
    track: "https://track-eu.customer.io/api/v1/",
    app: "https://api-eu.customer.io/v1/",
  },
};

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
    const region = String(config.region ?? "track.customer.io");
    if (!Object.hasOwn(REGIONS, region))
      throw new AuthError("invalid_credentials");
    const bases = REGIONS[region];
    return {
      track: { baseUrl: bases.track, methods: ["POST", "PUT", "DELETE"] },
      app: { baseUrl: bases.app, methods: ["GET"] },
    };
  },
});
