import bitwarden from "../../../../runline-plugins/bitwarden/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: bitwarden,
  name: "bitwarden",
  config: {
    clientId: "organization.bw_client",
    clientSecret: "bw_secret",
    accessToken: "bw_access",
  },
  secrets: ["clientId", "clientSecret", "accessToken"],
  action: "group.get",
  input: { groupId: "g1" },
  response: { id: "g1" },
  target: "api",
  wire: {
    url: "https://api.bitwarden.com/public/groups/g1",
    header: ["authorization", "Bearer bw_access"],
  },
} satisfies CredentialFixture;
