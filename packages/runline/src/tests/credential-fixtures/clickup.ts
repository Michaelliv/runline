import clickup from "../../../../runline-plugins/clickup/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: clickup,
  name: "clickup",
  config: { accessToken: "clickup_token" },
  secrets: ["accessToken"],
  action: "task.get",
  input: { taskId: "t1" },
  response: { id: "t1" },
  target: "api",
  wire: {
    url: "https://api.clickup.com/api/v2/task/t1",
    header: ["authorization", "clickup_token"],
  },
} satisfies CredentialFixture;
