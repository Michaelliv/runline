import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as a bearer to Mailcheck's one API origin. The target is
 * the origin, not /v1/, so the `singleEmail:check` custom-method segment
 * sits second in the request path, clear of the leading-segment scheme check.
 */
export const mailcheckCredential = staticCredential({
  id: "mailcheck",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.mailcheck.co/",
      methods: ["POST"],
    },
  },
});
