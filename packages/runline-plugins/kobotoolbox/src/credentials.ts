import { httpsBase, staticCredential } from "runline";

/** An API token, sent as `Authorization: Token …` to the server in config. */
export const kobotoolboxCredential = staticCredential({
  id: "kobotoolbox",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token " },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/v2/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
