import mattermost from "../../../../runline-plugins/mattermost/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mattermost,
  name: "mattermost",
  config: {
    baseUrl: "https://mattermost.example.com",
    accessToken: "secret_mattermost",
  },
  secrets: ["accessToken"],
  action: "channel.statistics",
  input: { channelId: "c1" },
  response: { channel_id: "c1", member_count: 3 },
  target: "api",
  wire: {
    url: "https://mattermost.example.com/api/v4/channels/c1/stats",
    header: ["authorization", "Bearer secret_mattermost"],
  },
} satisfies CredentialFixture;
