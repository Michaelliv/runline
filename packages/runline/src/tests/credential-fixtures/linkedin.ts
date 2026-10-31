import linkedin from "../../../../runline-plugins/linkedin/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: linkedin,
  name: "linkedin",
  config: { accessToken: "li_token" },
  secrets: ["accessToken"],
  action: "post.create",
  input: { postAs: "person", personOrOrgId: "p1", text: "hello" },
  response: { id: "urn:li:share:1" },
  target: "api",
  wire: {
    url: "https://api.linkedin.com/rest/posts",
    header: ["authorization", "Bearer li_token"],
  },
} satisfies CredentialFixture;
