import instagram from "../../../../codemode-plugins/instagram/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: instagram,
  name: "instagram",
  config: { accessToken: "ig_token" },
  secrets: ["accessToken"],
  action: "media.get",
  input: { mediaId: "17895695668004550", fields: ["id"] },
  response: { id: "17895695668004550" },
  target: "graph",
  wire: {
    url: "https://graph.facebook.com/v27.0/17895695668004550?fields=id",
    header: ["authorization", "Bearer ig_token"],
  },
} satisfies CredentialFixture;
