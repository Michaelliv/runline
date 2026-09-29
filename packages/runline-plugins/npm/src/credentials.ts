import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An optional access token, sent as a bearer to the registry; without one,
 * public reads go unsigned. The registry URL is public config and must be
 * HTTPS. A scoped package name travels as one encoded segment.
 */
export const npmCredential = staticCredential({
  id: "npm",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  optional: true,
  targets: (config) => ({
    registry: {
      baseUrl: httpsBase(
        config.registryUrl ?? "https://registry.npmjs.org",
        "",
      ),
      methods: ["GET", "PUT"],
      encodedSlashes: true,
    },
  }),
});
