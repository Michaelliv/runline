import { staticCredential } from "../../_shared/credentials.js";

/** An authentication key, sent as `Authorization: DeepL-Auth-Key {key}` to
 *  the plan's API host: api.deepl.com for pro, api-free.deepl.com otherwise. */
export const deeplCredential = staticCredential({
  id: "deepl",
  auth: { kind: "apiKey", header: "Authorization", prefix: "DeepL-Auth-Key " },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl:
        config.plan === "pro"
          ? "https://api.deepl.com/v2/"
          : "https://api-free.deepl.com/v2/",
      methods: ["GET", "POST"],
    },
  }),
});
