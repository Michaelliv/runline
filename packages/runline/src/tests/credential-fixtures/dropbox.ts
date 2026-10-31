import dropbox from "../../../../runline-plugins/dropbox/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: dropbox,
  name: "dropbox",
  config: { accessToken: "dbx_token" },
  secrets: ["accessToken"],
  action: "folder.list",
  input: { path: "" },
  response: { entries: [{ name: "a.txt" }], cursor: "c1", has_more: false },
  target: "api",
  wire: {
    url: "https://api.dropboxapi.com/2/files/list_folder",
    header: ["authorization", "Bearer dbx_token"],
  },
} satisfies CredentialFixture;
