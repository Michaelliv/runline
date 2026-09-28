import uptimerobot from "../../../../runline-plugins/uptimerobot/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: uptimerobot,
  name: "uptimerobot",
  config: { apiKey: "ur_key" },
  secrets: ["apiKey"],
  action: "account.get",
  input: {},
  response: { stat: "ok", account: { email: "a@example.com" } },
  target: "api",
  wire: {
    url: "https://api.uptimerobot.com/v2/getAccountDetails",
    field: ["api_key", "ur_key"],
  },
} satisfies CredentialFixture;
