import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { plivoCredential } from "./credentials.js";

/** A Plivo JSON call beneath the account; Plivo's resource paths end in /. */
function apiRequest(
  ctx: ActionContext,
  resource: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, plivoCredential, "plivo", {
    target: "api",
    path: `${resource}/`,
    method: "POST",
    json: body,
  });
}

export default function plivo(rl: RunlinePluginAPI) {
  rl.setName("plivo");
  rl.setVersion("0.1.0");
  rl.setCredential(plivoCredential);

  rl.setConnectionSchema({
    authId: {
      type: "string",
      required: true,
      description: "Plivo Auth ID",
      env: "PLIVO_AUTH_ID",
    },
    authToken: {
      type: "string",
      required: true,
      description: "Plivo Auth Token",
      env: "PLIVO_AUTH_TOKEN",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS message via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { from, to, message } = input as Record<string, unknown>;
      return apiRequest(ctx, "Message", {
        src: from,
        dst: to,
        text: message,
      });
    },
  });

  rl.registerAction("mms.send", {
    access: "write",
    description: "Send an MMS message via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender number" },
      to: { type: "string", required: true, description: "Recipient number" },
      message: { type: "string", required: true },
      mediaUrls: {
        type: "string",
        required: true,
        description: "Comma-separated media URLs",
      },
    },
    async execute(input, ctx) {
      const { from, to, message, mediaUrls } = input as Record<string, unknown>;
      return apiRequest(ctx, "Message", {
        src: from,
        dst: to,
        text: message,
        type: "mms",
        media_urls: mediaUrls,
      });
    },
  });

  rl.registerAction("call.make", {
    access: "write",
    description: "Make a phone call via Plivo",
    inputSchema: {
      from: { type: "string", required: true, description: "Caller number" },
      to: { type: "string", required: true, description: "Destination number" },
      answerUrl: {
        type: "string",
        required: true,
        description: "URL for call answer XML",
      },
      answerMethod: {
        type: "string",
        required: false,
        description: "HTTP method for answer URL (GET or POST, default POST)",
      },
    },
    async execute(input, ctx) {
      const { from, to, answerUrl, answerMethod } = input as Record<
        string,
        unknown
      >;
      return apiRequest(ctx, "Call", {
        from,
        to,
        answer_url: answerUrl,
        answer_method: answerMethod ?? "POST",
      });
    },
  });
}
