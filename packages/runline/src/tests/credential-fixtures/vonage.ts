import vonage from "../../../../runline-plugins/vonage/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: vonage,
  name: "vonage",
  config: { apiKey: "vn_key", apiSecret: "vn_secret" },
  secrets: ["apiKey", "apiSecret"],
  action: "sms.send",
  input: { from: "Acme", to: "+15550100", text: "hi" },
  response: { messages: [{ status: "0" }] },
  target: "sms",
  wire: {
    url: "https://rest.nexmo.com/sms/json",
    field: ["api_secret", "vn_secret"],
  },
} satisfies CredentialFixture;
