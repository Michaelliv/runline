import pipedrive from "../../../../runline-plugins/pipedrive/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: pipedrive,
  name: "pipedrive",
  config: { apiToken: "pd_token" },
  secrets: ["apiToken"],
  action: "deal.get",
  input: { id: 3 },
  response: { success: true, data: { id: 3 } },
  target: "v2",
  wire: {
    url: "https://api.pipedrive.com/api/v2/deals/3?api_token=pd_token",
  },
} satisfies CredentialFixture;
