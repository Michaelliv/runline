import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://rest.moceanapi.com";

async function apiRequest(
  apiKey: string, apiSecret: string, endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  body["mocean-api-key"] = apiKey;
  body["mocean-api-secret"] = apiSecret;
  body["mocean-resp-format"] = "JSON";

  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Mocean API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function mocean(rl: RunlinePluginAPI) {
  rl.setName("mocean");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Mocean API key", env: "MOCEAN_API_KEY" },
    apiSecret: { type: "string", required: true, description: "Mocean API secret", env: "MOCEAN_API_SECRET" },
  });

  const creds = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    apiKey: ctx.connection.config.apiKey as string,
    apiSecret: ctx.connection.config.apiSecret as string,
  });

  rl.registerAction("sms.send", {
    description: "Send an SMS message",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
      dlrUrl: { type: "string", required: false, description: "Delivery report URL" },
    },
    async execute(input, ctx) {
      const { from, to, message, dlrUrl } = input as Record<string, unknown>;
      const { apiKey, apiSecret } = creds(ctx);
      const body: Record<string, unknown> = { "mocean-from": from, "mocean-to": to, "mocean-text": message };
      if (dlrUrl) { body["mocean-dlr-url"] = dlrUrl; body["mocean-dlr-mask"] = "1"; }
      const data = (await apiRequest(apiKey, apiSecret, "/rest/2/sms", body)) as Record<string, unknown>;
      return data.messages;
    },
  });

  rl.registerAction("voice.send", {
    description: "Make a voice call with text-to-speech",
    inputSchema: {
      from: { type: "string", required: true, description: "Caller number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true, description: "Text to speak" },
      language: { type: "string", required: false, description: "Language code: en-US (default), en-GB, cmn-CN, ja-JP, ko-KR" },
    },
    async execute(input, ctx) {
      const { from, to, message, language = "en-US" } = input as Record<string, unknown>;
      const { apiKey, apiSecret } = creds(ctx);
      const command = [{ action: "say", language, text: message }];
      const body: Record<string, unknown> = { "mocean-from": from, "mocean-to": to, "mocean-command": JSON.stringify(command) };
      const data = (await apiRequest(apiKey, apiSecret, "/rest/2/voice/dial", body)) as Record<string, unknown>;
      return data.voice;
    },
  });
}
