import thehiveProject from "../../../../runline-plugins/thehiveProject/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: thehiveProject,
  name: "thehiveProject",
  config: { url: "https://hive.example.com", apiKey: "hive_key" },
  secrets: ["apiKey"],
  action: "alert.get",
  input: { id: "~40964136" },
  response: { _id: "~40964136" },
  target: "api",
  wire: {
    url: "https://hive.example.com/api/v1/alert/~40964136",
    header: ["authorization", "Bearer hive_key"],
  },
} satisfies CredentialFixture;
