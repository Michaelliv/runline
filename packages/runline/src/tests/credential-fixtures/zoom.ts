import zoom from "../../../../runline-plugins/zoom/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zoom,
  name: "zoom",
  config: { accessToken: "zoom_token" },
  secrets: ["accessToken"],
  action: "meeting.get",
  input: { meetingId: "861" },
  response: { id: 861 },
  target: "api",
  wire: {
    url: "https://api.zoom.us/v2/meetings/861",
    header: ["authorization", "Bearer zoom_token"],
  },
} satisfies CredentialFixture;
