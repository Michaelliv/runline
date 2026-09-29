import trello from "../../../../runline-plugins/trello/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: trello,
  name: "trello",
  config: { apiKey: "trello_key", token: "trello_token" },
  secrets: ["apiKey", "token"],
  action: "board.get",
  input: { id: "b1" },
  response: { id: "b1" },
  target: "api",
  wire: {
    url: "https://api.trello.com/1/boards/b1?key=trello_key&token=trello_token",
  },
} satisfies CredentialFixture;
