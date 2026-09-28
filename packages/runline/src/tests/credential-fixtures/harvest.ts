import harvest from "../../../../runline-plugins/harvest/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: harvest,
  name: "harvest",
  config: { token: "harvest_pat", accountId: "12345" },
  secrets: ["token"],
  action: "user.me",
  input: {},
  response: { id: 1 },
  target: "api",
  wire: {
    url: "https://api.harvestapp.com/v2/users/me",
    header: ["authorization", "Bearer harvest_pat"],
  },
} satisfies CredentialFixture;
