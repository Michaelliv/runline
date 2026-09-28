import lemlist from "../../../../runline-plugins/lemlist/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: lemlist,
  name: "lemlist",
  config: { apiKey: "lemlist_key" },
  secrets: ["apiKey"],
  action: "team.get",
  input: {},
  response: { _id: "team1" },
  target: "api",
  wire: {
    url: "https://api.lemlist.com/api/team",
    header: ["authorization", "Basic OmxlbWxpc3Rfa2V5"],
  },
} satisfies CredentialFixture;
