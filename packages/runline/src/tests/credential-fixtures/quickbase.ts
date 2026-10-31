import quickbase from "../../../../runline-plugins/quickbase/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: quickbase,
  name: "quickbase",
  config: { hostname: "acme.quickbase.com", userToken: "qb_token" },
  secrets: ["userToken"],
  action: "field.list",
  input: { tableId: "tbl1" },
  response: [],
  target: "api",
  wire: {
    url: "https://api.quickbase.com/v1/fields?tableId=tbl1",
    header: ["authorization", "QB-USER-TOKEN qb_token"],
  },
} satisfies CredentialFixture;
