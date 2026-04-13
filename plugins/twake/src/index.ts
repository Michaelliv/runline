import type { RunlinePluginAPI } from "runline";

export default function twake(rl: RunlinePluginAPI) {
  rl.setName("twake");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Twake workspace API key", env: "TWAKE_API_KEY" },
  });

  rl.registerAction("message.send", {
    description: "Send a message to a Twake channel",
    inputSchema: {
      channelId: { type: "string", required: true },
      content: { type: "string", required: true },
      senderName: { type: "string", required: false },
      senderIcon: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const hiddenData: Record<string, unknown> = { allow_delete: "everyone" };
      if (p.senderName) hiddenData.custom_title = p.senderName;
      if (p.senderIcon) hiddenData.custom_icon = p.senderIcon;
      const body = {
        object: {
          channel_id: p.channelId,
          content: { formatted: p.content },
          hidden_data: hiddenData,
        },
      };
      const res = await fetch("https://plugins.twake.app/plugins/n8n/actions/message/save", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.connection.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Twake error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.object;
    },
  });
}
