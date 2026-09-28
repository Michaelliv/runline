import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as `Authorization: Key {key}` to fal's queue origin.
 *  CDN media downloads are credential-free and stay outside the broker. */
export const falCredential = staticCredential({
  id: "fal",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Key " },
  local: { secret: "apiKey" },
  targets: {
    queue: {
      baseUrl: "https://queue.fal.run/",
      methods: ["GET", "POST", "PUT"],
    },
  },
});
