import phantombuster from "../../../../runline-plugins/phantombuster/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: phantombuster,
  name: "phantombuster",
  config: { apiKey: "pb_key" },
  secrets: ["apiKey"],
  action: "agent.get",
  input: { agentId: "a1" },
  response: { id: "a1" },
  target: "api",
  wire: {
    url: "https://api.phantombuster.com/api/v2/agents/fetch?id=a1",
    header: ["x-phantombuster-key", "pb_key"],
  },
} satisfies CredentialFixture;
