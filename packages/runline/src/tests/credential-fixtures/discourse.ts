import discourse from "../../../../runline-plugins/discourse/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: discourse,
  name: "discourse",
  config: { host: "https://forum.example.com", apiKey: "disc_key" },
  secrets: ["apiKey"],
  action: "post.get",
  input: { postId: "42" },
  response: { id: 42 },
  target: "api",
  wire: {
    url: "https://forum.example.com/posts/42",
    header: ["api-key", "disc_key"],
  },
} satisfies CredentialFixture;
