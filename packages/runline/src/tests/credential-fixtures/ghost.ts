import ghost from "../../../../runline-plugins/ghost/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: ghost,
  name: "ghost",
  config: {
    url: "https://blog.example.com",
    adminApiKey: "6489d1c0a1b2c3d4e5f60718:00ff10ab",
  },
  secrets: ["adminApiKey"],
  action: "post.list",
  input: {},
  response: { posts: [] },
  target: "admin",
  wire: { url: "https://blog.example.com/ghost/api/admin/posts/" },
} satisfies CredentialFixture;
