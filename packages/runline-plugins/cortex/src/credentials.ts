import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The longest report wait analyzer.execute accepts. The waiting target
 * declares that wait plus a 60 s allowance for the exchange itself, which
 * lands exactly on the 10-minute host ceiling.
 */
export const MAX_WAIT_SECONDS = 540;

/**
 * A Cortex API key, sent as a bearer to the connection's own Cortex
 * instance beneath /api/. The `wait` target is the same surface with the
 * long deadline /job/{id}/waitreport holds a request open for.
 */
export const cortexCredential = staticCredential({
  id: "cortex",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => {
    const baseUrl = httpsBase(config.host, "api/");
    return {
      api: { baseUrl, methods: ["GET", "POST"] },
      wait: {
        baseUrl,
        methods: ["GET"],
        timeoutMs: MAX_WAIT_SECONDS * 1000 + 60_000,
      },
    };
  },
});
