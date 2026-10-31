import monday from "../../../../runline-plugins/monday/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: monday,
  name: "monday",
  config: { apiToken: "secret_monday" },
  secrets: ["apiToken"],
  action: "board.get",
  input: { boardId: "b1" },
  response: { data: { boards: [{ id: "b1" }] } },
  target: "api",
  wire: {
    url: "https://api.monday.com/v2/",
    header: ["authorization", "secret_monday"],
  },
} satisfies CredentialFixture;
