import wekan from "../../../../runline-plugins/wekan/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: wekan,
  name: "wekan",
  config: { url: "https://wekan.example.com", token: "wekan_token" },
  secrets: ["token"],
  action: "board.get",
  input: { boardId: "b1" },
  response: { _id: "b1" },
  target: "api",
  wire: {
    url: "https://wekan.example.com/api/boards/b1",
    header: ["authorization", "Bearer wekan_token"],
  },
} satisfies CredentialFixture;
