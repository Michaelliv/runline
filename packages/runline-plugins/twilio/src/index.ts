import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { twilioCredential } from "./credentials.js";

/** A Twilio form call beneath the account; empty fields are left out. */
function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, twilioCredential, "twilio", {
    target: "api",
    path: endpoint,
    method: "POST",
    form: Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== ""),
    ),
  });
}

function escapeXml(str: string): string {
  return str.replace(
    /[<>&"']/g,
    (ch) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[ch] || ch,
  );
}

export default function twilio(rl: RunlinePluginAPI) {
  rl.setName("twilio");
  rl.setVersion("0.1.0");
  rl.setCredential(twilioCredential);

  rl.setConnectionSchema({
    accountSid: {
      type: "string",
      required: true,
      description: "Twilio Account SID",
      env: "TWILIO_ACCOUNT_SID",
    },
    authToken: {
      type: "string",
      required: true,
      description: "Twilio Auth Token",
      env: "TWILIO_AUTH_TOKEN",
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS, MMS, or WhatsApp message",
    inputSchema: {
      from: {
        type: "string",
        required: true,
        description: "Sender phone number",
      },
      to: {
        type: "string",
        required: true,
        description: "Recipient phone number",
      },
      body: { type: "string", required: true, description: "Message text" },
      whatsapp: {
        type: "boolean",
        required: false,
        description: "Send via WhatsApp",
      },
      statusCallback: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      let from = p.from as string;
      let to = p.to as string;
      if (p.whatsapp) {
        from = `whatsapp:${from}`;
        to = `whatsapp:${to}`;
      }
      return apiRequest(ctx, "Messages.json", {
        From: from,
        To: to,
        Body: p.body,
        StatusCallback: p.statusCallback,
      });
    },
  });

  rl.registerAction("call.make", {
    access: "write",
    description: "Make a phone call",
    inputSchema: {
      from: { type: "string", required: true },
      to: { type: "string", required: true },
      message: {
        type: "string",
        required: true,
        description: "Text to speak or TwiML",
      },
      twiml: {
        type: "boolean",
        required: false,
        description: "If true, message is treated as raw TwiML",
      },
      statusCallback: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const twiml = p.twiml
        ? (p.message as string)
        : `<Response><Say>${escapeXml(p.message as string)}</Say></Response>`;
      return apiRequest(ctx, "Calls.json", {
        From: p.from,
        To: p.to,
        Twiml: twiml,
        StatusCallback: p.statusCallback,
      });
    },
  });
}
