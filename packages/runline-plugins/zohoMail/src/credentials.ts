import { type CredentialDeclaration, configChoice, grantSchema } from "runline";

/**
 * Zoho's data centres, each an accounts host and a mail API host. Tokens
 * are data-centre bound: one minted at accounts.zoho.eu is rejected by
 * mail.zoho.com, and the failure reads like a permissions problem rather
 * than a region one. `dc` therefore selects both hosts as a pair, so the
 * token endpoint and the API cannot drift apart.
 */
export const DC = {
  com: { accounts: "https://accounts.zoho.com", api: "https://mail.zoho.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://mail.zoho.eu" },
  in: { accounts: "https://accounts.zoho.in", api: "https://mail.zoho.in" },
  "com.au": {
    accounts: "https://accounts.zoho.com.au",
    api: "https://mail.zoho.com.au",
  },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://mail.zoho.jp" },
  ca: {
    accounts: "https://accounts.zohocloud.ca",
    api: "https://mail.zohocloud.ca",
  },
  "com.cn": {
    accounts: "https://accounts.zoho.com.cn",
    api: "https://mail.zoho.com.cn",
  },
  ae: { accounts: "https://accounts.zoho.ae", api: "https://mail.zoho.ae" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://mail.zoho.sa" },
} as const;

export type Dc = keyof typeof DC;

export const DCS = Object.keys(DC) as Dc[];

/** What `runline auth zohoMail` consents to, and the grant's tokens carry. */
export const SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.tags.READ",
];

/**
 * The owner's Zoho Mail grant: a refresh token renewed at the data
 * centre's accounts host, whose access tokens sign the mail API on the
 * same data centre. The client credentials go as form fields
 * (`client_secret_post`), as Zoho takes them. The broker signs with
 * `Authorization: Bearer`, which Zoho's OAuth accepts alongside its own
 * `Zoho-oauthtoken` scheme. An unknown `dc` is invalid_credentials, never
 * a default: a mistyped region would send the token to another one.
 */
export const zohoMailCredential: CredentialDeclaration = (config) => {
  const hosts = DC[configChoice(config.dc, DCS, "com")];
  return {
    type: {
      id: "zohoMail",
      methods: {
        oauth2: {
          schema: grantSchema,
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal: "refresh",
            scopes: SCOPES,
            definition: {
              id: "zohoMail.oauth2",
              provider: "zoho",
              refresh: {
                url: `${hosts.accounts}/oauth/v2/token`,
                clientAuthentication: "client_secret_post",
                encoding: "form",
              },
            },
          },
          targets: {
            api: {
              baseUrl: `${hosts.api}/api/`,
              methods: ["GET"],
            },
          },
          probe: {
            target: "api",
            path: "accounts",
            method: "GET",
            acceptedStatuses: [200],
          },
        },
      },
    },
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      ...(typeof config.clientSecret === "string"
        ? { clientSecret: config.clientSecret }
        : {}),
    },
  };
};
