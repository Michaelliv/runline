import type { RunlinePluginAPI } from "runline";

export default function vonage(rl: RunlinePluginAPI) {
  rl.setName("vonage");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Vonage API key", env: "VONAGE_API_KEY" },
    apiSecret: { type: "string", required: true, description: "Vonage API secret", env: "VONAGE_API_SECRET" },
  });

  rl.registerAction("sms.send", {
    description: "Send an SMS",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender name or number" },
      to: { type: "string", required: true, description: "Recipient number in E.164 format" },
      text: { type: "string", required: true, description: "Message text" },
      ttl: { type: "number", required: false, description: "Time-to-live in minutes (default 4320 = 72h)" },
      callback: { type: "string", required: false, description: "Webhook URL for delivery receipt" },
    },
    async execute(input, ctx) {
      const c = ctx.connection.config;
      const p = input as Record<string, unknown>;
      const form = new URLSearchParams();
      form.set("api_key", c.apiKey as string);
      form.set("api_secret", c.apiSecret as string);
      form.set("from", p.from as string);
      form.set("to", p.to as string);
      form.set("text", p.text as string);
      form.set("type", "text");
      if (p.ttl) form.set("ttl", String((p.ttl as number) * 60000));
      if (p.callback) form.set("callback", p.callback as string);
      const res = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!res.ok) throw new Error(`Vonage error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.messages;
    },
  });
}
