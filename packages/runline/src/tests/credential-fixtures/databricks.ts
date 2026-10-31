import databricks from "../../../../runline-plugins/databricks/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: databricks,
  name: "databricks",
  config: {
    host: "https://adb-12345.azuredatabricks.net",
    accessToken: "secret_databricks",
  },
  secrets: ["accessToken"],
  action: "catalog.get",
  input: { name: "main" },
  response: { name: "main" },
  target: "workspace",
  wire: {
    url: "https://adb-12345.azuredatabricks.net/api/2.1/unity-catalog/catalogs/main",
    header: ["authorization", "Bearer secret_databricks"],
  },
} satisfies CredentialFixture;
