import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { sms77Credential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }
  return credentialJson(ctx, sms77Credential, "sms77", {
    target: "api",
    path: endpoint,
    method: "POST",
    body: form.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      SentWith: "runline",
    },
  });
}

export default function sms77(rl: RunlinePluginAPI) {
  rl.setName("sms77");
  rl.setVersion("0.1.0");
  rl.setCredential(sms77Credential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "seven (sms77) API key",
      env: "SMS77_API_KEY",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS via seven",
    inputSchema: {
      to: {
        type: "string",
        required: true,
        description: "Recipient number(s), comma-separated",
      },
      message: {
        type: "string",
        required: true,
        description: "Message text (max 1520 chars)",
      },
      from: { type: "string", required: false, description: "Sender ID" },
      flash: { type: "boolean", required: false },
      delay: {
        type: "string",
        required: false,
        description: "Scheduled send time",
      },
      ttl: {
        type: "number",
        required: false,
        description: "Time to live in minutes",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { to: p.to, text: p.message };
      if (p.from) body.from = p.from;
      if (p.flash) body.flash = 1;
      if (p.delay) body.delay = p.delay;
      if (p.ttl) body.ttl = p.ttl;
      return apiRequest(ctx, "sms", body);
    },
  });

  rl.registerAction("voice.send", {
    access: "write",
    description: "Convert text to voice and call a number",
    inputSchema: {
      to: { type: "string", required: true },
      message: { type: "string", required: true, description: "Text to speak" },
      from: { type: "string", required: false, description: "Caller ID" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { to: p.to, text: p.message };
      if (p.from) body.from = p.from;
      return apiRequest(ctx, "voice", body);
    },
  });
}
