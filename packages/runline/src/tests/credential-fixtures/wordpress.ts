import wordpress from "../../../../runline-plugins/wordpress/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: wordpress,
  name: "wordpress",
  config: {
    url: "https://blog.example.com",
    username: "wp_user",
    password: "wp_app_pass",
  },
  secrets: ["username", "password"],
  action: "post.get",
  input: { id: "11" },
  response: { id: 11 },
  target: "api",
  wire: {
    url: "https://blog.example.com/wp-json/wp/v2/posts/11",
    header: ["authorization", "Basic d3BfdXNlcjp3cF9hcHBfcGFzcw=="],
  },
} satisfies CredentialFixture;
