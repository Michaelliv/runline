import storyblok from "../../../../runline-plugins/storyblok/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: storyblok,
  name: "storyblok",
  config: { contentToken: "sb_content", managementToken: "sb_mgmt" },
  secrets: ["contentToken", "managementToken"],
  action: "content.story.get",
  input: { identifier: "blog/post" },
  response: { story: { slug: "post" } },
  target: "content",
  wire: {
    url: "https://api.storyblok.com/v1/cdn/stories/blog/post?token=sb_content",
  },
} satisfies CredentialFixture;
