import gett from "../../../../runline-plugins/gett/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: gett,
  name: "gett",
  config: {
    phone: "972500000000",
    refreshToken: "gett_refresh",
    accessToken: "gett_access",
    deviceId: "device-1",
    clientDeviceUniqueId: "cdui-1",
  },
  secrets: ["refreshToken", "accessToken"],
  action: "driver.listNearby",
  input: { lat: 32, lon: 34 },
  response: { drivers: [] },
  target: "api",
  wire: {
    url: "https://b2cgateway.gett.com/gl/api/v2/drivers/locations?lat=32&lng=34",
    header: ["authorization", "Bearer gett_access"],
  },
} satisfies CredentialFixture;
