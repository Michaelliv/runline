import facebookGraph from "../../../../runline-plugins/facebookGraph/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: facebookGraph,
  name: "facebookGraph",
  config: { accessToken: "fb_token" },
  secrets: ["accessToken"],
  action: "request",
  input: { node: "me" },
  response: { id: "1" },
  target: "graph",
  wire: { url: "https://graph.facebook.com/me?access_token=fb_token" },
} satisfies CredentialFixture;
