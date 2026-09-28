import contentful from "../../../../runline-plugins/contentful/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: contentful,
  name: "contentful",
  config: { spaceId: "s1", deliveryAccessToken: "cf_deliv" },
  secrets: ["deliveryAccessToken"],
  action: "space.get",
  input: {},
  response: { sys: { id: "s1" } },
  target: "api",
  wire: {
    url: "https://cdn.contentful.com/spaces/s1?access_token=cf_deliv",
  },
} satisfies CredentialFixture;
