import rundeck from "../../../../runline-plugins/rundeck/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: rundeck,
  name: "rundeck",
  config: {
    url: "https://rundeck.example.com",
    token: "secret_rundeck",
  },
  secrets: ["token"],
  action: "job.getMetadata",
  input: { jobId: "j1" },
  response: { id: "j1" },
  target: "api",
  wire: {
    url: "https://rundeck.example.com/api/18/job/j1/info?authtoken=secret_rundeck",
  },
} satisfies CredentialFixture;
