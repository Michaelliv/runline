import { configChoice, staticCredential } from "runline";
import { GRAPH_VERSION } from "../../_shared/metaGraph.js";

/**
 * Meta's two hosts for the Instagram API. Which one a token works on is
 * decided by the login that issued it: Facebook Login and Unified Login
 * tokens (a Facebook User, Page or system user token) on
 * graph.facebook.com, Instagram Login tokens on graph.instagram.com.
 */
export const HOSTS = ["graph.facebook.com", "graph.instagram.com"] as const;
export type Host = (typeof HOSTS)[number];

/** The host the connection's token works on; a mistyped one is refused. */
export function apiHost(config: Readonly<Record<string, unknown>>): Host {
  return configChoice(config.apiHost, HOSTS, "graph.facebook.com");
}

/**
 * A Meta access token. The API host takes it as a bearer; Meta's video
 * upload host takes the same token under its own `OAuth` scheme, with the
 * headers that describe the upload.
 */
export const instagramCredential = staticCredential({
  id: "instagram",
  auth: {
    kind: "static",
    parts: ["token"],
    placements: [
      {
        in: "header",
        part: "token",
        name: "Authorization",
        prefix: "Bearer ",
        targets: ["graph"],
      },
      {
        in: "header",
        part: "token",
        name: "Authorization",
        prefix: "OAuth ",
        targets: ["upload"],
      },
    ],
  },
  local: { token: "accessToken" },
  targets: (config) => ({
    graph: {
      baseUrl: `https://${apiHost(config)}/${GRAPH_VERSION}/`,
      methods: ["GET", "POST", "DELETE"],
    },
    upload: {
      baseUrl: `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/`,
      methods: ["POST"],
      allowedHeaders: ["offset", "file_size", "file_url"],
      timeoutMs: 10 * 60_000,
    },
  }),
  probe: {
    target: "graph",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
