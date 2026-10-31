import vero from "../../../../runline-plugins/vero/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: vero,
  name: "vero",
  config: { authToken: "vero_token" },
  secrets: ["authToken"],
  action: "user.create",
  input: { id: "u1", data: { plan: "pro" } },
  response: { status: 200 },
  target: "api",
  wire: {
    url: "https://api.getvero.com/api/v2/users/track",
    field: ["auth_token", "vero_token"],
  },
} satisfies CredentialFixture;
