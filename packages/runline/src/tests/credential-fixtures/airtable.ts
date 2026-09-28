import airtable from "../../../../runline-plugins/airtable/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: airtable,
  name: "airtable",
  config: { token: "pat_airtable" },
  secrets: ["token"],
  action: "record.get",
  input: { baseId: "app1", tableId: "tbl1", recordId: "rec1" },
  response: { id: "rec1" },
  target: "api",
  wire: {
    url: "https://api.airtable.com/v0/app1/tbl1/rec1",
    header: ["authorization", "Bearer pat_airtable"],
  },
} satisfies CredentialFixture;
