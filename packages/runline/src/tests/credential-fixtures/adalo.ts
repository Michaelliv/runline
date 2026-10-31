import adalo from "../../../../runline-plugins/adalo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: adalo,
  name: "adalo",
  config: { appId: "app1", apiKey: "adalo_secret" },
  secrets: ["apiKey"],
  action: "collection.get",
  input: { collectionId: "c1", rowId: "r1" },
  response: { id: "r1" },
  target: "api",
  wire: {
    url: "https://api.adalo.com/v0/apps/app1/collections/c1/r1",
    header: ["authorization", "Bearer adalo_secret"],
  },
} satisfies CredentialFixture;
