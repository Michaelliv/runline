import vercel from "../../../../runline-plugins/vercel/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: vercel,
  name: "vercel",
  config: { token: "secret_vercel" },
  secrets: ["token"],
  action: "whoami",
  input: {},
  response: { user: { id: "u1" } },
  target: "api",
  wire: {
    url: "https://api.vercel.com/v2/user",
    header: ["authorization", "Bearer secret_vercel"],
  },
} satisfies CredentialFixture;
