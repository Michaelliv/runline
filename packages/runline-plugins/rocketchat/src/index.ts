import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { rocketchatCredential } from "./credentials.js";

export default function rocketchat(rl: RunlinePluginAPI) {
  rl.setName("rocketchat");
  rl.setVersion("0.1.0");
  rl.setCredential(rocketchatCredential);

  rl.setConnectionSchema({
    domain: {
      type: "string",
      required: true,
      description: "Rocket.Chat server URL (e.g. https://chat.example.com)",
      env: "ROCKETCHAT_DOMAIN",
    },
    userId: {
      type: "string",
      required: true,
      description: "User ID",
      env: "ROCKETCHAT_USER_ID",
    },
    authToken: {
      type: "string",
      required: true,
      description: "Auth token",
      env: "ROCKETCHAT_AUTH_TOKEN",
    },
  });

  rl.registerAction("chat.postMessage", {
    access: "write",
    description: "Post a message to a Rocket.Chat channel or DM",
    inputSchema: {
      channel: {
        type: "string",
        required: true,
        description: "Channel name with prefix (e.g. #general or @username)",
      },
      text: { type: "string", required: true },
      alias: {
        type: "string",
        required: false,
        description: "Display name alias",
      },
      emoji: {
        type: "string",
        required: false,
        description: "Emoji avatar (e.g. :smile:)",
      },
      avatar: {
        type: "string",
        required: false,
        description: "Avatar image URL",
      },
      attachments: {
        type: "object",
        required: false,
        description: "Array of attachment objects",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        channel: p.channel,
        text: p.text,
      };
      if (p.alias) body.alias = p.alias;
      if (p.emoji) body.emoji = p.emoji;
      if (p.avatar) body.avatar = p.avatar;
      if (p.attachments) body.attachments = p.attachments;

      return credentialJson(ctx, rocketchatCredential, "rocketchat", {
        target: "api",
        path: "chat.postMessage",
        method: "POST",
        headers: { "X-User-Id": String(ctx.connection.config.userId ?? "") },
        json: body,
      });
    },
  });
}
