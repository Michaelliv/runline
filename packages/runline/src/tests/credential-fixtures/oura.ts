import oura from "../../../../runline-plugins/oura/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: oura,
  name: "oura",
  config: { accessToken: "oura_token" },
  secrets: ["accessToken"],
  action: "profile.get",
  input: {},
  response: { id: "u1" },
  target: "api",
  wire: {
    url: "https://api.ouraring.com/v2/usercollection/personal_info",
    header: ["authorization", "Bearer oura_token"],
  },
} satisfies CredentialFixture;
