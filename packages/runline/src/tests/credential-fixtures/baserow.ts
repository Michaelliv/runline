import baserow from "../../../../runline-plugins/baserow/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: baserow,
  name: "baserow",
  config: { host: "https://api.baserow.io", token: "baserow_secret" },
  secrets: ["token"],
  action: "row.get",
  input: { tableId: "t1", rowId: "r1" },
  response: { id: 1 },
  target: "api",
  wire: {
    url: "https://api.baserow.io/api/database/rows/table/t1/r1/",
    header: ["authorization", "Token baserow_secret"],
  },
} satisfies CredentialFixture;
