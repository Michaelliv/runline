import strava from "../../../../runline-plugins/strava/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: strava,
  name: "strava",
  config: { accessToken: "strava_token" },
  secrets: ["accessToken"],
  action: "activity.get",
  input: { activityId: "42" },
  response: { id: 42 },
  target: "api",
  wire: {
    url: "https://www.strava.com/api/v3/activities/42",
    header: ["authorization", "Bearer strava_token"],
  },
} satisfies CredentialFixture;
