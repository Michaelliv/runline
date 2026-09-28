import stackby from "../../../../runline-plugins/stackby/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: stackby,
  name: "stackby",
  config: { apiKey: "stackby_key" },
  secrets: ["apiKey"],
  action: "row.list",
  input: { stackId: "st1", table: "Table 1", limit: 2 },
  response: [{ field: { id: "r1" } }],
  target: "api",
  wire: {
    url: "https://stackby.com/api/betav1/rowlist/st1/Table%201?maxrecord=2",
    header: ["api-key", "stackby_key"],
  },
} satisfies CredentialFixture;
