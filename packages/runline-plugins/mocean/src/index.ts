import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { moceanCredential } from "./credentials.js";

/** A Mocean form call, answered in JSON. */
function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, moceanCredential, "mocean", {
    target: "api",
    path: endpoint,
    method: "POST",
    form: { ...body, "mocean-resp-format": "JSON" },
  });
}

export default function mocean(rl: RunlinePluginAPI) {
  rl.setName("mocean");
  rl.setVersion("0.1.0");
  rl.setCredential(moceanCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Mocean API key",
      env: "MOCEAN_API_KEY",
    },
    apiSecret: {
      type: "string",
      required: true,
      description: "Mocean API secret",
      env: "MOCEAN_API_SECRET",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS message",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
      dlrUrl: {
        type: "string",
        required: false,
        description: "Delivery report URL",
      },
    },
    async execute(input, ctx) {
      const { from, to, message, dlrUrl } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        "mocean-from": from,
        "mocean-to": to,
        "mocean-text": message,
      };
      if (dlrUrl) {
        body["mocean-dlr-url"] = dlrUrl;
        body["mocean-dlr-mask"] = "1";
      }
      const data = (await apiRequest(ctx, "sms", body)) as Record<
        string,
        unknown
      >;
      return data.messages;
    },
  });

  rl.registerAction("voice.send", {
    access: "write",
    description: "Make a voice call with text-to-speech",
    inputSchema: {
      from: { type: "string", required: true, description: "Caller number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true, description: "Text to speak" },
      language: {
        type: "string",
        required: false,
        description:
          "Language code: en-US (default), en-GB, cmn-CN, ja-JP, ko-KR",
      },
    },
    async execute(input, ctx) {
      const {
        from,
        to,
        message,
        language = "en-US",
      } = input as Record<string, unknown>;
      const command = [{ action: "say", language, text: message }];
      const body: Record<string, unknown> = {
        "mocean-from": from,
        "mocean-to": to,
        "mocean-command": JSON.stringify(command),
      };
      const data = (await apiRequest(ctx, "voice/dial", body)) as Record<
        string,
        unknown
      >;
      return data.voice;
    },
  });
}
