import paypal from "../../../../runline-plugins/paypal/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: paypal,
  name: "paypal",
  config: {
    clientId: "pp_client",
    secret: "pp_secret",
    env: "sandbox",
    // A fresh grant in the flat CLI fields, so the local run signs
    // without a token request first.
    accessToken: "pp_access",
    accessTokenExpiresAt: 4102444800000,
  },
  secrets: ["secret", "accessToken"],
  action: "payout.get",
  input: { payoutBatchId: "B1" },
  response: { items: [] },
  target: "api",
  wire: {
    url: "https://api-m.sandbox.paypal.com/v1/payments/payouts/B1",
    header: ["authorization", "Bearer pp_access"],
  },
} satisfies CredentialFixture;
