import splunk from "../../../../runline-plugins/splunk/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: splunk,
  name: "splunk",
  config: {
    baseUrl: "https://splunk.example.com:8089",
    authToken: "secret_splunk",
  },
  secrets: ["authToken"],
  action: "search.get",
  input: { searchJobId: "sid1" },
  response: { sid: "sid1" },
  target: "api",
  wire: {
    url: "https://splunk.example.com:8089/services/search/jobs/sid1?output_mode=json",
    header: ["authorization", "Bearer secret_splunk"],
  },
} satisfies CredentialFixture;
