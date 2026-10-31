import parallel from "../../../../runline-plugins/parallel/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: parallel,
  name: "parallel",
  config: { apiKey: "par_key" },
  secrets: ["apiKey"],
  action: "search",
  input: { objective: "office vacancy rates" },
  response: { search_id: "s1", results: [] },
  target: "api",
  wire: {
    url: "https://api.parallel.ai/v1beta/search",
    header: ["x-api-key", "par_key"],
  },
} satisfies CredentialFixture;
