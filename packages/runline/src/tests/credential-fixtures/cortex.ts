import cortex from "../../../../runline-plugins/cortex/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: cortex,
  name: "cortex",
  config: { host: "https://cortex.example.test", apiKey: "cortex_key" },
  secrets: ["apiKey"],
  action: "job.get",
  input: { jobId: "j1" },
  response: { id: "j1", status: "Success" },
  target: "api",
  wire: {
    url: "https://cortex.example.test/api/job/j1",
    header: ["authorization", "Bearer cortex_key"],
  },
} satisfies CredentialFixture;
