import dhl from "../../../../runline-plugins/dhl/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: dhl,
  name: "dhl",
  config: { apiKey: "dhl_key" },
  secrets: ["apiKey"],
  action: "shipment.track",
  input: { trackingNumber: "123456789" },
  response: { shipments: [] },
  target: "api",
  wire: {
    url: "https://api-eu.dhl.com/track/shipments?trackingNumber=123456789",
    header: ["dhl-api-key", "dhl_key"],
  },
} satisfies CredentialFixture;
