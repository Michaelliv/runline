import tapfiliate from "../../../../runline-plugins/tapfiliate/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: tapfiliate,
  name: "tapfiliate",
  config: { apiKey: "tf_secret" },
  secrets: ["apiKey"],
  action: "affiliate.get",
  input: { affiliateId: "a1" },
  response: { id: "a1" },
  target: "api",
  wire: {
    url: "https://api.tapfiliate.com/1.6/affiliates/a1/",
    header: ["api-key", "tf_secret"],
  },
} satisfies CredentialFixture;
