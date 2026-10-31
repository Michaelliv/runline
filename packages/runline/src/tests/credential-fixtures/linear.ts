import linear from "../../../../runline-plugins/linear/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: linear,
  name: "linear",
  config: { apiKey: "lin_fixture" },
  secrets: ["apiKey"],
  action: "team.list",
  input: {},
  response: {
    data: {
      teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    },
  },
  target: "gql",
  wire: {
    url: "https://api.linear.app/graphql",
    header: ["authorization", "lin_fixture"],
  },
} satisfies CredentialFixture;
