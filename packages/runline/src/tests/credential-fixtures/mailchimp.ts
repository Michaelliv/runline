import mailchimp from "../../../../runline-plugins/mailchimp/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mailchimp,
  name: "mailchimp",
  config: { apiKey: "mc_key-us21", server: "us21" },
  secrets: ["apiKey"],
  action: "campaign.get",
  input: { campaignId: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://us21.api.mailchimp.com/3.0/campaigns/c1",
    header: ["authorization", "Basic YW55c3RyaW5nOm1jX2tleS11czIx"],
  },
} satisfies CredentialFixture;
