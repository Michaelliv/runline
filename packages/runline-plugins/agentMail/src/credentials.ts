import { configChoice, staticCredential } from "../../_shared/credentials.js";

const REGIONS = ["us", "eu"] as const;
const ORIGINS = {
  us: "https://api.agentmail.to/v0/",
  eu: "https://api.agentmail.eu/v0/",
} as const;

/**
 * An AgentMail API key, sent as a bearer to the region's one API origin.
 * Sends get their own `send` target: AgentMail deduplicates sends (and only
 * sends) by `Idempotency-Key`, so that is where the contract is declared and
 * the transport sets the header. Inbox and draft creation deduplicate by the
 * body's `client_id` instead and stay on `api`.
 */
export const agentMailCredential = staticCredential({
  id: "agentMail",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => {
    const baseUrl = ORIGINS[configChoice(config.region, REGIONS, "us")];
    return {
      api: { baseUrl, methods: ["GET", "POST", "PATCH", "DELETE"] },
      send: {
        baseUrl,
        methods: ["POST"],
        idempotency: { header: "Idempotency-Key", methods: ["POST"] },
      },
    };
  },
  probe: {
    target: "api",
    path: "auth/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
