import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    domain: (c.domain as string).replace(/\/$/, ""),
    userId: c.userId as string,
    authToken: c.authToken as string,
  };
}

export default function rocketchat(rl: RunlinePluginAPI) {
  rl.setName("rocketchat");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    domain: { type: "string", required: true, description: "Rocket.Chat server URL (e.g. https://chat.example.com)", env: "ROCKETCHAT_DOMAIN" },
    userId: { type: "string", required: true, description: "User ID", env: "ROCKETCHAT_USER_ID" },
    authToken: { type: "string", required: true, description: "Auth token", env: "ROCKETCHAT_AUTH_TOKEN" },
  });

  rl.registerAction("chat.postMessage", {
    description: "Post a message to a Rocket.Chat channel or DM",
    inputSchema: {
      channel: { type: "string", required: true, description: "Channel name with prefix (e.g. #general or @username)" },
      text: { type: "string", required: true },
      alias: { type: "string", required: false, description: "Display name alias" },
      emoji: { type: "string", required: false, description: "Emoji avatar (e.g. :smile:)" },
      avatar: { type: "string", required: false, description: "Avatar image URL" },
      attachments: { type: "object", required: false, description: "Array of attachment objects" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const conn = getConn(ctx);
      const body: Record<string, unknown> = { channel: p.channel, text: p.text };
      if (p.alias) body.alias = p.alias;
      if (p.emoji) body.emoji = p.emoji;
      if (p.avatar) body.avatar = p.avatar;
      if (p.attachments) body.attachments = p.attachments;

      const res = await fetch(`${conn.domain}/api/v1/chat.postMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": conn.authToken,
          "X-User-Id": conn.userId,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Rocket.Chat error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
