import segment from "../../../../runline-plugins/segment/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: segment,
  name: "segment",
  config: { writeKey: "seg_wk" },
  secrets: ["writeKey"],
  action: "track.event",
  input: { event: "signup", userId: "u1" },
  response: { success: true },
  target: "api",
  wire: {
    url: "https://api.segment.io/v1/track",
    header: ["authorization", `Basic ${btoa("seg_wk:")}`],
  },
} satisfies CredentialFixture;
