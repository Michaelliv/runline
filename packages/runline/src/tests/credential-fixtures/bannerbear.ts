import bannerbear from "../../../../runline-plugins/bannerbear/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: bannerbear,
  name: "bannerbear",
  config: { apiKey: "bb_key" },
  secrets: ["apiKey"],
  action: "template.get",
  input: { templateId: "t1" },
  response: { uid: "t1" },
  target: "api",
  wire: {
    url: "https://api.bannerbear.com/v2/templates/t1",
    header: ["authorization", "Bearer bb_key"],
  },
} satisfies CredentialFixture;
