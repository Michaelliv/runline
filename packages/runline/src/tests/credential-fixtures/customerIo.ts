import customerIo from "../../../../runline-plugins/customerIo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: customerIo,
  name: "customerIo",
  config: {
    siteId: "site1",
    trackingApiKey: "cio_track",
    appApiKey: "cio_app",
  },
  secrets: ["siteId", "trackingApiKey", "appApiKey"],
  action: "event.trackAnonymous",
  input: { eventName: "signup" },
  response: {},
  target: "track",
  wire: {
    url: "https://track.customer.io/api/v1/events",
    header: [
      "authorization",
      `Basic ${Buffer.from("site1:cio_track").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
