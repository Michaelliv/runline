import jenkins from "../../../../runline-plugins/jenkins/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: jenkins,
  name: "jenkins",
  config: {
    baseUrl: "https://jenkins.example.com",
    username: "admin",
    apiToken: "jenkins_token",
  },
  secrets: ["username", "apiToken"],
  action: "job.getParameters",
  input: { jobName: "myjob" },
  response: { actions: [] },
  target: "api",
  wire: {
    url: "https://jenkins.example.com/job/myjob/api/json?tree=actions%5BparameterDefinitions%5B*%5D%5D",
    header: ["authorization", "Basic YWRtaW46amVua2luc190b2tlbg=="],
  },
} satisfies CredentialFixture;
