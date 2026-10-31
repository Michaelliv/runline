import misp from "../../../../runline-plugins/misp/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: misp,
  name: "misp",
  config: { baseUrl: "https://misp.example.com", apiKey: "misp_key" },
  secrets: ["apiKey"],
  action: "event.get",
  input: { eventId: "9" },
  response: { Event: { id: "9" } },
  target: "api",
  wire: {
    url: "https://misp.example.com/events/view/9",
    header: ["authorization", "misp_key"],
  },
} satisfies CredentialFixture;
