import { staticCredential } from "../../_shared/credentials.js";

/**
 * A source write key as the Basic username with a fixed empty password,
 * to Segment's v1 tracking API.
 */
export const segmentCredential = staticCredential({
  id: "segment",
  auth: { kind: "basic" },
  local: { username: "writeKey", password: { value: "" } },
  targets: {
    api: {
      baseUrl: "https://api.segment.io/v1/",
      methods: ["POST"],
    },
  },
});
