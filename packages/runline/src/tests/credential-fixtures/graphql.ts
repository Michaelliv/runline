import graphql from "../../../../runline-plugins/graphql/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: graphql,
  name: "graphql",
  config: {
    endpoint: "https://api.example.com/v1/graphql",
    headerAuth: "Bearer gql_token",
  },
  secrets: ["headerAuth"],
  action: "query",
  input: { query: "{ me { id } }" },
  response: { data: { me: { id: 1 } } },
  target: "api",
  wire: {
    url: "https://api.example.com/v1/graphql",
    header: ["authorization", "Bearer gql_token"],
  },
} satisfies CredentialFixture;
