import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The configured endpoint as a target base and the path beneath it:
 * `https://api.example.com/v1/graphql` is the base
 * `https://api.example.com/v1/` and the path `graphql`. Only a plain HTTPS
 * URL is an endpoint.
 */
export function endpoint(config: Readonly<Record<string, unknown>>): {
  base: string;
  path: string;
} {
  httpsBase(config.endpoint, "");
  const url = new URL(String(config.endpoint));
  const cut = url.pathname.lastIndexOf("/") + 1;
  return {
    base: `${url.origin}${url.pathname.slice(0, cut)}`,
    path: url.pathname.slice(cut),
  };
}

/** The connection's public headers, sent on every request. */
export function publicHeaders(
  config: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const headers = config.headers;
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, String(value)]),
  );
}

/**
 * An optional Authorization value (`headerAuth`, e.g. `Bearer <token>`),
 * sent whole to the configured endpoint; without it, requests go
 * unsigned. `headers` holds public headers only, and may not claim
 * Authorization: a secret belongs in headerAuth.
 */
export const graphqlCredential = staticCredential({
  id: "graphql",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "headerAuth" },
  optional: true,
  targets: (config) => ({
    api: {
      baseUrl: endpoint(config).base,
      methods: ["POST"],
      allowedHeaders: Object.keys(publicHeaders(config)),
    },
  }),
});
