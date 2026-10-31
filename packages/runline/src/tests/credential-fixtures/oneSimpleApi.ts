import oneSimpleApi from "../../../../runline-plugins/oneSimpleApi/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: oneSimpleApi,
  name: "oneSimpleApi",
  config: { apiToken: "osa_token" },
  secrets: ["apiToken"],
  action: "socialProfile.instagram",
  input: { profile: "nasa" },
  response: { profile: "nasa" },
  target: "api",
  wire: {
    url: "https://onesimpleapi.com/api/instagram_profile?output=json&profile=nasa&token=osa_token",
  },
} satisfies CredentialFixture;
