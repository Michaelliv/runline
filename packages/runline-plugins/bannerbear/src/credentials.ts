import { staticCredential } from "../../_shared/credentials.js";

/** A project API key, sent as a bearer to Bannerbear's one API origin. */
export const bannerbearCredential = staticCredential({
  id: "bannerbear",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.bannerbear.com/v2/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "account",
    method: "GET",
    acceptedStatuses: [200],
  },
});
