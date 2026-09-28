import gong from "../../../../runline-plugins/gong/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: gong,
  name: "gong",
  config: { accessKey: "gong_key", accessKeySecret: "gong_secret" },
  secrets: ["accessKey", "accessKeySecret"],
  action: "user.get",
  input: { userId: "u1" },
  response: { users: [{ id: "u1" }] },
  target: "api",
  wire: {
    url: "https://api.gong.io/v2/users/extensive",
    header: ["authorization", "Basic Z29uZ19rZXk6Z29uZ19zZWNyZXQ="],
  },
} satisfies CredentialFixture;
