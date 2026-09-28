import stripe from "../../../../runline-plugins/stripe/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: stripe,
  name: "stripe",
  config: { secretKey: "sk_test_stripe" },
  secrets: ["secretKey"],
  action: "balance.get",
  input: {},
  response: { object: "balance" },
  target: "api",
  wire: {
    url: "https://api.stripe.com/v1/balance",
    header: ["authorization", "Bearer sk_test_stripe"],
  },
} satisfies CredentialFixture;
