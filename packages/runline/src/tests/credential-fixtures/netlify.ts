import netlify from "../../../../runline-plugins/netlify/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: netlify,
  name: "netlify",
  config: { accessToken: "secret_netlify" },
  secrets: ["accessToken"],
  action: "site.get",
  input: { siteId: "s1" },
  response: { id: "s1", name: "my-site" },
  target: "api",
  wire: {
    url: "https://api.netlify.com/api/v1/sites/s1",
    header: ["authorization", "Bearer secret_netlify"],
  },
} satisfies CredentialFixture;
