/**
 * Facebook Graph API plugin for runline: one action that reads or changes
 * any node or edge the connection's token reaches. Typed plugins exist
 * for parts of the graph (instagram, facebookPages); this is the rest of
 * it.
 */
import { pathSegment, type RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { metaGraph } from "../../_shared/metaGraph.js";
import { stringEnum } from "../../_shared/schemas.js";
import { facebookGraphCredential } from "./credentials.js";

const PLUGIN = "facebookGraph";
const STRICT = { additionalProperties: false } as const;
const { request } = metaGraph({
  plugin: PLUGIN,
  credential: facebookGraphCredential,
});

const HOSTS = ["graph.facebook.com", "graph-video.facebook.com"] as const;
/** The credential target each of Meta's hosts is declared as. */
const TARGETS = {
  "graph.facebook.com": "graph",
  "graph-video.facebook.com": "video",
} as const satisfies Record<(typeof HOSTS)[number], string>;

const requestInput = t.Object(
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
          "API version, as v27.0. Omit for the app's default version",
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
          description: "JSON body; with method POST only",
        },
      ),
    ),
  },
  {
    ...STRICT,
    // A body goes out with a POST alone, so any other method refuses one.
    anyOf: [
      { not: { required: ["body"] } },
      { required: ["method"], properties: { method: { const: "POST" } } },
    ],
  },
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
    inputSchema: requestInput,
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
      } = input as t.Static<typeof requestInput>;
      const path = [
        graphApiVersion,
        pathSegment(node),
        edge === undefined ? undefined : pathSegment(edge),
      ]
        .filter((segment) => segment !== undefined)
        .join("/");
      // The token travels in the query, so Meta repeats it in paging
      // links, and a Page's answer carries the Page's own: the answer
      // comes back without either.
      return request(ctx, {
        target: TARGETS[hostUrl],
        path,
        method,
        query: { ...queryParameters, fields: fields?.join(",") },
        json: body,
      });
    },
  });
}
