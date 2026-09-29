import discord from "../../../../runline-plugins/discord/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: discord,
  name: "discord",
  config: { botToken: "discord_bot", guildId: "g1" },
  secrets: ["botToken"],
  action: "channel.get",
  input: { channelId: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://discord.com/api/v10/channels/c1",
    header: ["authorization", "Bot discord_bot"],
  },
} satisfies CredentialFixture;
