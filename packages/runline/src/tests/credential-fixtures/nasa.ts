import nasa from "../../../../runline-plugins/nasa/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: nasa,
  name: "nasa",
  config: { apiKey: "nasa_key" },
  secrets: ["apiKey"],
  action: "asteroidNeoLookup.get",
  input: { asteroidId: "3542519" },
  response: { id: "3542519" },
  target: "api",
  wire: {
    url: "https://api.nasa.gov/neo/rest/v1/neo/3542519?api_key=nasa_key",
  },
} satisfies CredentialFixture;
