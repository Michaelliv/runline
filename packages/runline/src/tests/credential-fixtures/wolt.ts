import wolt from "../../../../runline-plugins/wolt/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: wolt,
  name: "wolt",
  config: {
    refreshToken: "wolt_refresh",
    accessToken: "wolt_access",
    deviceToken: "device-1",
    visitorId: "visitor-1",
    woltSessionId: "session-1",
    ravelinDeviceId: "rvnand-6-abc",
  },
  secrets: ["refreshToken", "accessToken"],
  action: "address.list",
  input: {},
  response: { results: [] },
  target: "restaurant",
  wire: {
    url: "https://restaurant-api.wolt.com/v2/delivery/info",
    header: ["authorization", "Bearer wolt_access"],
  },
} satisfies CredentialFixture;
