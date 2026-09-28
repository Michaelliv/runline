import spotify from "../../../../runline-plugins/spotify/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: spotify,
  name: "spotify",
  config: { accessToken: "spotify_token" },
  secrets: ["accessToken"],
  action: "track.get",
  input: { id: "abc" },
  response: { id: "abc" },
  target: "api",
  wire: {
    url: "https://api.spotify.com/v1/tracks/abc",
    header: ["authorization", "Bearer spotify_token"],
  },
} satisfies CredentialFixture;
