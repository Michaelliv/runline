import signl4 from "../../../../runline-plugins/signl4/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: signl4,
  name: "signl4",
  config: { teamSecret: "s4secret" },
  secrets: ["teamSecret"],
  action: "alert.resolve",
  input: { externalId: "x1" },
  response: { eventId: "e1" },
  target: "webhook",
  wire: {
    url: "https://connect.signl4.com/webhook/s4secret",
    field: ["X-S4-Status", "resolved"],
  },
} satisfies CredentialFixture;
