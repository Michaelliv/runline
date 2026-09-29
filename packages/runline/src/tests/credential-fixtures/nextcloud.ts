import nextcloud from "../../../../runline-plugins/nextcloud/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: nextcloud,
  name: "nextcloud",
  config: {
    webDavUrl: "https://cloud.example.com/remote.php/webdav",
    username: "nc_user",
    password: "nc_pass",
  },
  secrets: ["username", "password"],
  action: "folder.create",
  input: { path: "/invoices/2019" },
  response: {},
  target: "dav",
  wire: {
    url: "https://cloud.example.com/remote.php/webdav/invoices/2019",
    header: [
      "authorization",
      `Basic ${Buffer.from("nc_user:nc_pass").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
