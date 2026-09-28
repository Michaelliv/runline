import { AuthError, type HttpMethod, type RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { facebookGraphCredential } from "./credentials.js";

/** Meta's hosts, by the target each is declared as. */
const HOSTS: Record<string, "graph" | "video"> = {
  "graph.facebook.com": "graph",
  "graph-video.facebook.com": "video",
};

export default function facebookGraph(rl: RunlinePluginAPI) {
  rl.setName("facebookGraph");
  rl.setVersion("0.1.0");
  rl.setCredential(facebookGraphCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Facebook/Meta access token",
      env: "FACEBOOK_ACCESS_TOKEN",
    },
  });

  rl.registerAction("request", {
    access: "write",
    description:
      "Make a request to the Facebook Graph API. Supports GET, POST, DELETE against any node/edge combination.",
    inputSchema: {
      hostUrl: {
        type: "string",
        required: false,
        description:
          "Host URL: 'graph.facebook.com' (default) or 'graph-video.facebook.com' for video uploads",
      },
      method: {
        type: "string",
        required: false,
        description: "HTTP method: GET (default), POST, DELETE",
      },
      graphApiVersion: {
        type: "string",
        required: false,
        description: "API version (e.g. 'v19.0'). Omit for default.",
      },
      node: {
        type: "string",
        required: true,
        description: "Node ID (e.g. 'me', a page/user/object ID)",
      },
      edge: {
        type: "string",
        required: false,
        description: "Edge name (e.g. 'posts', 'feed', 'videos')",
      },
      fields: {
        type: "array",
        required: false,
        description:
          "Fields to request (GET only), sent as comma-separated 'fields' param",
      },
      queryParameters: {
        type: "object",
        required: false,
        description: "Additional query parameters as key-value pairs",
      },
      body: {
        type: "object",
        required: false,
        description: "Request body for POST requests (sent as JSON)",
      },
    },
    async execute(input, ctx) {
      const {
        hostUrl = "graph.facebook.com",
        method = "GET",
        graphApiVersion = "",
        node,
        edge,
        fields,
        queryParameters,
        body,
      } = input as Record<string, unknown>;

      const target = Object.hasOwn(HOSTS, String(hostUrl))
        ? HOSTS[String(hostUrl)]
        : undefined;
      if (
        !target ||
        (graphApiVersion && !/^v\d+\.\d+$/.test(String(graphApiVersion)))
      )
        throw new AuthError("request_not_allowed");
      const httpMethod = String(method).toUpperCase() as HttpMethod;
      const path = [
        graphApiVersion,
        pathSegment(node),
        edge ? pathSegment(edge) : "",
      ]
        .filter(Boolean)
        .join("/");
      return credentialJson(ctx, facebookGraphCredential, "facebookGraph", {
        target,
        path,
        method: httpMethod,
        query: {
          ...(queryParameters as Record<string, unknown> | undefined),
          ...(Array.isArray(fields) && fields.length
            ? { fields: fields.join(",") }
            : {}),
        },
        ...(httpMethod === "POST" &&
        body &&
        typeof body === "object" &&
        Object.keys(body).length
          ? { json: body }
          : {}),
      });
    },
  });
}
