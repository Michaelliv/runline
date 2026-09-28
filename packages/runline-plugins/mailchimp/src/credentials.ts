import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * The API key as the Basic password (Mailchimp ignores the username), on
 * the account's own datacenter host. The datacenter is the public
 * `server` config field when set, else the key's own `-dc` suffix — so
 * flat CLI configs keep working unchanged, and a secret-free brokered
 * config selects its host from `server`. With neither, hostLabel refuses
 * the connection as invalid_credentials.
 */
export const mailchimpCredential = staticCredential({
  id: "mailchimp",
  auth: { kind: "basic" },
  local: { username: { value: "anystring" }, password: "apiKey" },
  targets: (config) => {
    const server =
      config.server ??
      (typeof config.apiKey === "string"
        ? config.apiKey.split("-").pop()
        : undefined);
    return {
      api: {
        baseUrl: `https://${hostLabel(server)}.api.mailchimp.com/3.0/`,
        methods: ["GET", "POST", "PUT", "DELETE"],
      },
    };
  },
  probe: {
    target: "api",
    path: "ping",
    method: "GET",
    acceptedStatuses: [200],
  },
});
