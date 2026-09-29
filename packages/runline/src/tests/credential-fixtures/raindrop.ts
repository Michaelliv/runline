import raindrop from "../../../../runline-plugins/raindrop/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: raindrop,
  name: "raindrop",
  config: { accessToken: "raindrop_token" },
  secrets: ["accessToken"],
  action: "bookmark.get",
  input: { bookmarkId: "11" },
  response: { item: { _id: 11 } },
  target: "api",
  wire: {
    url: "https://api.raindrop.io/rest/v1/raindrop/11",
    header: ["authorization", "Bearer raindrop_token"],
  },
} satisfies CredentialFixture;
