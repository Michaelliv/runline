import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key as the Basic username, with an empty password, to Onfleet's
 * one API origin. The fixed User-Agent is a public companion header.
 */
export const onfleetCredential = staticCredential({
  id: "onfleet",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "" } },
  targets: {
    api: {
      baseUrl: "https://onfleet.com/api/v2/",
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["User-Agent"],
    },
  },
  probe: {
    target: "api",
    path: "organization",
    method: "GET",
    acceptedStatuses: [200],
  },
});
