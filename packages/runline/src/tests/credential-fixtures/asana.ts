import asana from "../../../../runline-plugins/asana/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: asana,
  name: "asana",
  config: { token: "asana_pat" },
  secrets: ["token"],
  action: "task.get",
  input: { taskId: "t1" },
  response: { data: { gid: "t1" } },
  target: "api",
  wire: {
    url: "https://app.asana.com/api/1.0/tasks/t1",
    header: ["authorization", "Bearer asana_pat"],
  },
} satisfies CredentialFixture;
