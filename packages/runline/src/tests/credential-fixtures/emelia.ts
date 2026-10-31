import emelia from "../../../../runline-plugins/emelia/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: emelia,
  name: "emelia",
  config: { apiKey: "em_secret" },
  secrets: ["apiKey"],
  action: "campaign.get",
  input: { campaignId: "c1" },
  response: { data: { campaign: { _id: "c1", name: "Launch" } } },
  target: "gql",
  wire: {
    url: "https://graphql.emelia.io/graphql",
    header: ["authorization", "em_secret"],
  },
} satisfies CredentialFixture;
