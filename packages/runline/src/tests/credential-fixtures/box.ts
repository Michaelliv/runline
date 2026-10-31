import box from "../../../../runline-plugins/box/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: box,
  name: "box",
  config: { accessToken: "secret_box" },
  secrets: ["accessToken"],
  action: "file.get",
  input: { fileId: "f1" },
  response: { id: "f1", type: "file" },
  target: "api",
  wire: {
    url: "https://api.box.com/2.0/files/f1",
    header: ["authorization", "Bearer secret_box"],
  },
} satisfies CredentialFixture;
