/**
 * Facebook Graph API plugin for runline: one action that reads or changes
 * any node or edge the connection's token reaches. Typed plugins exist
 * for parts of the graph (instagram); this is the rest of it.
 */
import { credentialJson, pathSegment, type RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { withoutAccessTokens } from "../../_shared/metaGraph.js";
import { stringEnum } from "../../_shared/schemas.js";
import { facebookGraphCredential } from "./credentials.js";

const PLUGIN = "facebookGraph";
const STRICT = { additionalProperties: false } as const;

const HOSTS = ["graph.facebook.com", "graph-video.facebook.com"] as const;
/** The credential target each of Meta's hosts is declared as. */
const TARGETS = {
  "graph.facebook.com": "graph",
  "graph-video.facebook.com": "video",
} as const satisfies Record<(typeof HOSTS)[number], string>;

const request = t.Object(
  {
    hostUrl: t.Optional(
      stringEnum(HOSTS, {
        description:
          "graph.facebook.com (default), or graph-video.facebook.com for video uploads",
      }),
    ),
    method: t.Optional(
      stringEnum(["GET", "POST", "DELETE"] as const, {
        description: "HTTP method (default GET)",
      }),
    ),
    graphApiVersion: t.Optional(
      t.String({
        pattern: "^v\\d+\\.\\d+$",
        description:
          "API version, as v27.0. Omit for the oldest version the app may use",
      }),
    ),
    node: t.String({
      minLength: 1,
      description: "Node: me, or a Page, user or object ID",
    }),
    edge: t.Optional(
      t.String({
        minLength: 1,
        description: "Edge of the node: posts, feed, videos",
      }),
    ),
    fields: t.Optional(
      t.Array(t.String({ minLength: 1 }), {
        minItems: 1,
        description:
          "Fields to return, sent as the comma-separated fields parameter",
      }),
    ),
    queryParameters: t.Optional(
      t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean()]), {
        description: "Further query parameters, by name",
      }),
    ),
    body: t.Optional(
      t.Object(
        {},
        {
          additionalProperties: true,
          description: "JSON body of a POST",
        },
      ),
    ),
  },
  STRICT,
);

export default function facebookGraph(rl: RunlinePluginAPI) {
  rl.setName(PLUGIN);
  rl.setVersion("0.1.0");
  rl.setCredential(facebookGraphCredential);

  rl.setConnectionSchema(
    t.Object({
      accessToken: t.String({
        minLength: 1,
        env: "FACEBOOK_ACCESS_TOKEN",
        description: "Meta access token",
      }),
    }),
  );

  rl.registerAction("request", {
    access: "write",
    description:
      "A Facebook Graph API request: GET, POST or DELETE on any node, or an edge of it. The answer carries no access token: Meta's paging links and Page objects are returned without theirs.",
    inputSchema: request,
    async execute(input, ctx) {
      const {
        hostUrl = "graph.facebook.com",
        method = "GET",
        graphApiVersion,
        node,
        edge,
        fields,
        queryParameters,
        body,
      } = input as t.Static<typeof request>;
      const path = [
        graphApiVersion,
        pathSegment(node),
        edge === undefined ? undefined : pathSegment(edge),
      ]
        .filter((segment) => segment !== undefined)
        .join("/");
      // The token travels in the query, so Meta repeats it in paging
      // links, and a Page's answer carries the Page's own.
      return withoutAccessTokens(
        await credentialJson(ctx, facebookGraphCredential, PLUGIN, {
          target: TARGETS[hostUrl],
          path,
          method,
          query: { ...queryParameters, fields: fields?.join(",") },
          ...(method === "POST" && body && Object.keys(body).length
            ? { json: body }
            : {}),
        }),
      );
    },
  });
}
