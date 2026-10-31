import demio from "../../../../runline-plugins/demio/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: demio,
  name: "demio",
  config: { apiKey: "demio_key", apiSecret: "demio_secret" },
  secrets: ["apiKey", "apiSecret"],
  action: "event.get",
  input: { eventId: "e1" },
  response: { id: "e1" },
  target: "api",
  wire: {
    url: "https://my.demio.com/api/v1/event/e1",
    header: ["api-secret", "demio_secret"],
  },
} satisfies CredentialFixture;
