import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as a bearer to Currents' one API origin. */
export const currentsCredential = staticCredential({
  id: "currents",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.currents.dev/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "projects",
    method: "GET",
    acceptedStatuses: [200],
  },
});
