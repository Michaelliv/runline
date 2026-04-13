import type { RunlinePluginAPI } from "runline";

export default function facebookGraph(rl: RunlinePluginAPI) {
  rl.setName("facebookGraph");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Facebook/Meta access token", env: "FACEBOOK_ACCESS_TOKEN" },
  });

  rl.registerAction("request", {
    description: "Make a request to the Facebook Graph API. Supports GET, POST, DELETE against any node/edge combination.",
    inputSchema: {
      hostUrl: { type: "string", required: false, description: "Host URL: 'graph.facebook.com' (default) or 'graph-video.facebook.com' for video uploads" },
      method: { type: "string", required: false, description: "HTTP method: GET (default), POST, DELETE" },
      graphApiVersion: { type: "string", required: false, description: "API version (e.g. 'v19.0'). Omit for default." },
      node: { type: "string", required: true, description: "Node ID (e.g. 'me', a page/user/object ID)" },
      edge: { type: "string", required: false, description: "Edge name (e.g. 'posts', 'feed', 'videos')" },
      fields: { type: "array", required: false, description: "Fields to request (GET only), sent as comma-separated 'fields' param" },
      queryParameters: { type: "object", required: false, description: "Additional query parameters as key-value pairs" },
      body: { type: "object", required: false, description: "Request body for POST requests (sent as JSON)" },
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

      const versionPrefix = graphApiVersion ? `${graphApiVersion}/` : "";
      let uri = `https://${hostUrl}/${versionPrefix}${node}`;
      if (edge) uri = `${uri}/${edge}`;

      const url = new URL(uri);
      url.searchParams.set("access_token", ctx.connection.config.accessToken as string);

      if (fields && Array.isArray(fields) && fields.length > 0) {
        url.searchParams.set("fields", fields.join(","));
      }

      if (queryParameters && typeof queryParameters === "object") {
        for (const [k, v] of Object.entries(queryParameters as Record<string, unknown>)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }
      }

      const httpMethod = (method as string).toUpperCase();
      const opts: RequestInit = {
        method: httpMethod,
        headers: { Accept: "application/json,text/*;q=0.99" },
      };

      if (body && typeof body === "object" && Object.keys(body as object).length > 0 && httpMethod === "POST") {
        (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(url.toString(), opts);
      if (!res.ok) throw new Error(`Facebook Graph API error ${res.status}: ${await res.text()}`);

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { message: text };
      }
    },
  });
}
