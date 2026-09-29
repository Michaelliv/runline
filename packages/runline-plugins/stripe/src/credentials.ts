import { staticCredential } from "../../_shared/credentials.js";

/** A secret key, sent as a bearer to Stripe's v1 API base. */
export const stripeCredential = staticCredential({
  id: "stripe",
  auth: { kind: "bearer" },
  local: { secret: "secretKey" },
  targets: {
    api: {
      baseUrl: "https://api.stripe.com/v1/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "balance",
    method: "GET",
    acceptedStatuses: [200],
  },
});
