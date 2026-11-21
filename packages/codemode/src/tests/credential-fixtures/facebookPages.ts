import facebookPages from "../../../../codemode-plugins/facebookPages/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: facebookPages,
  name: "facebookPages",
  config: { accessToken: "page_token" },
  secrets: ["accessToken"],
  action: "page.get",
  input: { fields: ["id"] },
  response: { id: "134895793791914" },
  target: "graph",
  wire: {
    url: "https://graph.facebook.com/v27.0/me?fields=id",
    header: ["authorization", "Bearer page_token"],
  },
} satisfies CredentialFixture;
