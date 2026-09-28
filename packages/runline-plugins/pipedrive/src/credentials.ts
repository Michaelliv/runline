import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, appended by the transport as the api_token query parameter
 * on Pipedrive's v2 and v1 API bases.
 */
export const pipedriveCredential = staticCredential({
  id: "pipedrive",
  auth: { kind: "queryKey", param: "api_token" },
  local: { secret: "apiToken" },
  targets: {
    v2: {
      baseUrl: "https://api.pipedrive.com/api/v2/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
    v1: {
      baseUrl: "https://api.pipedrive.com/v1/",
      methods: ["GET", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "v1",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
