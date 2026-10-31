import grist from "../../../../runline-plugins/grist/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: grist,
  name: "grist",
  config: { apiKey: "secret_grist" },
  secrets: ["apiKey"],
  action: "record.list",
  input: { docId: "d1", tableId: "t1" },
  response: { records: [] },
  target: "api",
  wire: {
    url: "https://docs.getgrist.com/api/docs/d1/tables/t1/records",
    header: ["authorization", "Bearer secret_grist"],
  },
} satisfies CredentialFixture;
