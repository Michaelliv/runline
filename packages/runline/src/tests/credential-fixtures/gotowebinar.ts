import gotowebinar from "../../../../runline-plugins/gotowebinar/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: gotowebinar,
  name: "gotowebinar",
  config: { accessToken: "secret_g2w", organizerKey: "org1" },
  secrets: ["accessToken"],
  action: "webinar.get",
  input: { webinarKey: "w1" },
  response: { webinarKey: "w1" },
  target: "api",
  wire: {
    url: "https://api.getgo.com/G2W/rest/v2/organizers/org1/webinars/w1",
    header: ["authorization", "Bearer secret_g2w"],
  },
} satisfies CredentialFixture;
