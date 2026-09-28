import { staticCredential } from "../../_shared/credentials.js";

/** One API key, sent as a bearer to Clearbit's three read-only API hosts:
 *  person enrichment, company enrichment, and name autocomplete. */
export const clearbitCredential = staticCredential({
  id: "clearbit",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    person: {
      baseUrl: "https://person-stream.clearbit.com/v2/",
      methods: ["GET"],
    },
    company: {
      baseUrl: "https://company-stream.clearbit.com/v2/",
      methods: ["GET"],
    },
    autocomplete: {
      baseUrl: "https://autocomplete.clearbit.com/v1/",
      methods: ["GET"],
    },
  },
});
