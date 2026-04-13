import type { RunlinePluginAPI } from "runline";

export default function graphql(rl: RunlinePluginAPI) {
  rl.setName("graphql");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    endpoint: { type: "string", required: true, description: "GraphQL endpoint URL", env: "GRAPHQL_ENDPOINT" },
    headerAuth: { type: "string", required: false, description: "Authorization header value (e.g. 'Bearer xxx')", env: "GRAPHQL_AUTH_HEADER" },
    headers: { type: "object", required: false, description: "Additional headers as key-value pairs" },
  });

  rl.registerAction("query", {
    description: "Execute a GraphQL query",
    inputSchema: {
      query: { type: "string", required: true, description: "GraphQL query or mutation string" },
      variables: { type: "object", required: false, description: "Query variables" },
      operationName: { type: "string", required: false, description: "Operation name (if query contains multiple)" },
    },
    async execute(input, ctx) {
      const { query, variables, operationName } = input as Record<string, unknown>;
      const cfg = ctx.connection.config;
      const endpoint = cfg.endpoint as string;

      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.headerAuth) hdrs.Authorization = cfg.headerAuth as string;
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers as Record<string, string>)) {
          hdrs[k] = v;
        }
      }

      const body: Record<string, unknown> = { query };
      if (variables) body.variables = variables;
      if (operationName) body.operationName = operationName;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`GraphQL error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      if (data.errors) throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      return data.data;
    },
  });

  rl.registerAction("introspect", {
    description: "Run an introspection query to get the schema",
    async execute(_input, ctx) {
      const cfg = ctx.connection.config;
      const endpoint = cfg.endpoint as string;

      const hdrs: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.headerAuth) hdrs.Authorization = cfg.headerAuth as string;
      if (cfg.headers) {
        for (const [k, v] of Object.entries(cfg.headers as Record<string, string>)) {
          hdrs[k] = v;
        }
      }

      const introspectionQuery = `{
        __schema {
          types { name kind description fields { name type { name kind ofType { name kind } } } }
          queryType { name }
          mutationType { name }
          subscriptionType { name }
        }
      }`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ query: introspectionQuery }),
      });

      if (!res.ok) throw new Error(`GraphQL error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.data;
    },
  });
}
