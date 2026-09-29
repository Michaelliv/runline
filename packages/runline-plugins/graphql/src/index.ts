import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson, graphqlFailed } from "../../_shared/credentials.js";
import { endpoint, graphqlCredential, publicHeaders } from "./credentials.js";

/** One GraphQL request to the configured endpoint; `errors` in the answer is a failure. */
async function gql(
  ctx: ActionContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  const config = ctx.connection.config;
  const answer = await credentialJson<{ data?: unknown; errors?: unknown }>(
    ctx,
    graphqlCredential,
    "graphql",
    {
      target: "api",
      path: endpoint(config).path,
      method: "POST",
      json: body,
      headers: publicHeaders(config),
    },
  );
  if (answer.errors) throw graphqlFailed("graphql", answer.errors);
  return answer.data;
}

export default function graphql(rl: RunlinePluginAPI) {
  rl.setName("graphql");
  rl.setVersion("0.1.0");
  rl.setCredential(graphqlCredential);

  rl.setConnectionSchema({
    endpoint: {
      type: "string",
      required: true,
      description: "GraphQL endpoint URL (HTTPS)",
      env: "GRAPHQL_ENDPOINT",
    },
    headerAuth: {
      type: "string",
      required: false,
      description: "Authorization header value (e.g. 'Bearer xxx')",
      env: "GRAPHQL_AUTH_HEADER",
    },
    headers: {
      type: "object",
      required: false,
      description:
        "Additional public headers as key-value pairs; a secret belongs in headerAuth",
    },
  });

  rl.registerAction("query", {
    access: "write",
    description: "Execute a GraphQL query",
    inputSchema: {
      query: {
        type: "string",
        required: true,
        description: "GraphQL query or mutation string",
      },
      variables: {
        type: "object",
        required: false,
        description: "Query variables",
      },
      operationName: {
        type: "string",
        required: false,
        description: "Operation name (if query contains multiple)",
      },
    },
    async execute(input, ctx) {
      const { query, variables, operationName } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { query };
      if (variables) body.variables = variables;
      if (operationName) body.operationName = operationName;
      return gql(ctx, body);
    },
  });

  rl.registerAction("introspect", {
    access: "read",
    description: "Run an introspection query to get the schema",
    async execute(_input, ctx) {
      const introspectionQuery = `{
        __schema {
          types { name kind description fields { name type { name kind ofType { name kind } } } }
          queryType { name }
          mutationType { name }
          subscriptionType { name }
        }
      }`;

      return gql(ctx, { query: introspectionQuery });
    },
  });
}
