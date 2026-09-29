import { staticCredential } from "../../_shared/credentials.js";

/**
 * A personal access token, sent as a bearer to Harvest's one API origin.
 * Every request also carries the public Harvest-Account-Id companion
 * header and Harvest's required User-Agent.
 */
export const harvestCredential = staticCredential({
  id: "harvest",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: {
    api: {
      baseUrl: "https://api.harvestapp.com/v2/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Harvest-Account-Id", "User-Agent"],
    },
  },
  // No probe: every accepted request needs the Harvest-Account-Id header,
  // which a fixed probe cannot carry.
});
