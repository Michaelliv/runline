import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key as the Basic password with the fixed username "api", to
 * Mailgun's two documented regional origins. The connection's apiDomain
 * picks the region; any other value is refused rather than signed for.
 */
export const mailgunCredential = staticCredential({
  id: "mailgun",
  auth: { kind: "basic" },
  local: { username: { value: "api" }, password: "apiKey" },
  targets: {
    us: { baseUrl: "https://api.mailgun.net/v3/", methods: ["POST"] },
    eu: { baseUrl: "https://api.eu.mailgun.net/v3/", methods: ["POST"] },
  },
});

/** The target the connection's apiDomain names. */
export function mailgunRegion(
  config: Readonly<Record<string, unknown>>,
): string {
  const domain = (config.apiDomain as string) ?? "api.mailgun.net";
  if (domain === "api.mailgun.net") return "us";
  if (domain === "api.eu.mailgun.net") return "eu";
  throw new Error(
    "mailgun: apiDomain must be api.mailgun.net or api.eu.mailgun.net",
  );
}
