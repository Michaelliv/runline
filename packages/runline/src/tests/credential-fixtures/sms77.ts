import sms77 from "../../../../runline-plugins/sms77/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: sms77,
  name: "sms77",
  config: { apiKey: "seven_key" },
  secrets: ["apiKey"],
  action: "sms.send",
  input: { to: "+491710000000", message: "hello" },
  response: { success: "100" },
  target: "api",
  wire: {
    url: "https://gateway.seven.io/api/sms",
    header: ["x-api-key", "seven_key"],
  },
} satisfies CredentialFixture;
