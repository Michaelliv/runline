import { staticCredential } from "../../_shared/credentials.js";

/** An integration token, sent as a bearer to Medium's one API origin. */
export const mediumCredential = staticCredential({
  id: "medium",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.medium.com/v1/",
      methods: ["GET", "POST"],
      allowedHeaders: ["Accept-Charset"],
    },
  },
  probe: {
    target: "api",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
