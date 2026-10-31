import halopsa from "../../../../runline-plugins/halopsa/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: halopsa,
  name: "halopsa",
  config: {
    resourceApiUrl: "https://example.halopsa.com/api",
    authUrl: "https://example.halopsa.com/auth",
    clientId: "halo_client",
    clientSecret: "halo_secret",
    accessToken: "halo_token",
  },
  secrets: ["clientSecret", "accessToken"],
  action: "client.get",
  input: { id: 1 },
  response: { id: 1 },
  target: "api",
  wire: {
    url: "https://example.halopsa.com/api/client/1",
    header: ["authorization", "Bearer halo_token"],
  },
} satisfies CredentialFixture;
