import convertkit from "../../../../runline-plugins/convertkit/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: convertkit,
  name: "convertkit",
  config: { apiSecret: "ck_secret" },
  secrets: ["apiSecret"],
  action: "customField.get",
  input: { id: "7" },
  response: { id: 7 },
  target: "api",
  wire: {
    url: "https://api.convertkit.com/v3/custom_fields/7?api_secret=ck_secret",
  },
} satisfies CredentialFixture;
