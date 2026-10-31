import { staticCredential } from "runline";

/** An API key, sent as a bearer to Brandfetch's one API origin. */
export const brandfetchCredential = staticCredential({
  id: "brandfetch",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.brandfetch.io/v2/",
      methods: ["GET"],
    },
  },
});
