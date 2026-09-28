import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { twakeCredential } from "./credentials.js";

export default function twake(rl: RunlinePluginAPI) {
  rl.setName("twake");
  rl.setVersion("0.1.0");
  rl.setCredential(twakeCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Twake workspace API key",
      env: "TWAKE_API_KEY",
    },
  });

  rl.registerAction("message.send", {
    access: "write",
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
      const data = (await credentialJson(ctx, twakeCredential, "twake", {
        target: "api",
        path: "save",
        method: "POST",
        json: body,
      })) as Record<string, unknown>;
      return data.object;
    },
  });
}
