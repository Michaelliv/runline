import strapi from "../../../../runline-plugins/strapi/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: strapi,
  name: "strapi",
  config: { url: "https://cms.example.com", apiToken: "st_token" },
  secrets: ["apiToken"],
  action: "entry.get",
  input: { contentType: "articles", entryId: "1" },
  response: { data: { id: 1 } },
  target: "api",
  wire: {
    url: "https://cms.example.com/api/articles/1",
    header: ["authorization", "Bearer st_token"],
  },
} satisfies CredentialFixture;
