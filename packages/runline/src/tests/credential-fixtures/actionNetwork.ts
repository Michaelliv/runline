import actionNetwork from "../../../../runline-plugins/actionNetwork/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: actionNetwork,
  name: "actionNetwork",
  config: { apiKey: "an_secret" },
  secrets: ["apiKey"],
  action: "event.get",
  input: { eventId: "e1" },
  response: { title: "Rally" },
  target: "api",
  wire: {
    url: "https://actionnetwork.org/api/v2/events/e1",
    header: ["osdi-api-token", "an_secret"],
  },
} satisfies CredentialFixture;
