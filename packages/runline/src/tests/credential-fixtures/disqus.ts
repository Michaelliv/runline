import disqus from "../../../../runline-plugins/disqus/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: disqus,
  name: "disqus",
  config: { apiKey: "secret_disqus" },
  secrets: ["apiKey"],
  action: "forum.get",
  input: { forum: "f1" },
  response: { response: { id: "f1" } },
  target: "api",
  wire: {
    url: "https://disqus.com/api/3.0/forums/details.json?forum=f1&api_key=secret_disqus",
  },
} satisfies CredentialFixture;
