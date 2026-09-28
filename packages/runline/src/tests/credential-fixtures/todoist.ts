import todoist from "../../../../runline-plugins/todoist/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: todoist,
  name: "todoist",
  config: { apiToken: "todoist_token" },
  secrets: ["apiToken"],
  action: "task.get",
  input: { id: "t1" },
  response: { id: "t1" },
  target: "rest",
  wire: {
    url: "https://api.todoist.com/rest/v2/tasks/t1",
    header: ["authorization", "Bearer todoist_token"],
  },
} satisfies CredentialFixture;
