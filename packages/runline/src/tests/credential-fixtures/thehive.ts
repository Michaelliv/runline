import thehive from "../../../../runline-plugins/thehive/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: thehive,
  name: "thehive",
  config: { url: "https://hive.example.com", apiKey: "hive_secret" },
  secrets: ["apiKey"],
  action: "case.get",
  input: { id: "c1" },
  response: { _id: "c1", title: "Phishing" },
  target: "api",
  wire: {
    url: "https://hive.example.com/api/case/c1",
    header: ["authorization", "Bearer hive_secret"],
  },
} satisfies CredentialFixture;
