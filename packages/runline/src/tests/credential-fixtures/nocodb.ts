import nocodb from "../../../../runline-plugins/nocodb/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: nocodb,
  name: "nocodb",
  config: {
    host: "https://nocodb.example.com",
    apiToken: "secret_nocodb",
  },
  secrets: ["apiToken"],
  action: "row.get",
  input: { tableId: "t1", rowId: "r1" },
  response: { Id: "r1" },
  target: "api",
  wire: {
    url: "https://nocodb.example.com/api/v2/tables/t1/records/r1",
    header: ["xc-token", "secret_nocodb"],
  },
} satisfies CredentialFixture;
