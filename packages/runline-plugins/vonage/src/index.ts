import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { vonageCredential } from "./credentials.js";

export default function vonage(rl: RunlinePluginAPI) {
  rl.setName("vonage");
  rl.setVersion("0.1.0");
  rl.setCredential(vonageCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Vonage API key",
      env: "VONAGE_API_KEY",
    },
    apiSecret: {
      type: "string",
      required: true,
      description: "Vonage API secret",
      env: "VONAGE_API_SECRET",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS",
    inputSchema: {
      from: {
        type: "string",
        required: true,
        description: "Sender name or number",
      },
      to: {
        type: "string",
        required: true,
        description: "Recipient number in E.164 format",
      },
      text: { type: "string", required: true, description: "Message text" },
      ttl: {
        type: "number",
        required: false,
        description: "Time-to-live in minutes (default 4320 = 72h)",
      },
      callback: {
        type: "string",
        required: false,
        description: "Webhook URL for delivery receipt",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = await credentialJson<{ messages?: unknown }>(
        ctx,
        vonageCredential,
        "vonage",
        {
          target: "sms",
          path: "json",
          method: "POST",
          form: {
            from: p.from,
            to: p.to,
            text: p.text,
            type: "text",
            ttl: p.ttl ? (p.ttl as number) * 60000 : undefined,
            callback: p.callback,
          },
        },
      );
      return data.messages;
    },
  });
}
