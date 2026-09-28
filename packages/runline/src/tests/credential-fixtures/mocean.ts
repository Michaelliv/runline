import mocean from "../../../../runline-plugins/mocean/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mocean,
  name: "mocean",
  config: { apiKey: "mc_key", apiSecret: "mc_secret" },
  secrets: ["apiKey", "apiSecret"],
  action: "sms.send",
  input: { from: "Acme", to: "+15550100", message: "hi" },
  response: { messages: [{ status: 0 }] },
  target: "api",
  wire: {
    url: "https://rest.moceanapi.com/rest/2/sms",
    field: ["mocean-api-key", "mc_key"],
  },
} satisfies CredentialFixture;
