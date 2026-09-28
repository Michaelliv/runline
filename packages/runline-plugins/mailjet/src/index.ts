import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { mailjetCredential } from "./credentials.js";

/** One message through the v3.1 Send API, in sandbox mode when the connection asks. */
async function sendMessage(
  ctx: ActionContext,
  message: Record<string, unknown>,
): Promise<unknown> {
  const data = await credentialJson<{ Messages?: unknown }>(
    ctx,
    mailjetCredential,
    "mailjet",
    {
      target: "email",
      path: "send",
      method: "POST",
      json: {
        Messages: [message],
        SandboxMode:
          ctx.connection.config.sandboxMode === true ||
          ctx.connection.config.sandboxMode === "true",
      },
    },
  );
  return data.Messages;
}

export default function mailjet(rl: RunlinePluginAPI) {
  rl.setName("mailjet");
  rl.setVersion("0.1.0");
  rl.setCredential(mailjetCredential);

  rl.setConnectionSchema({
    apiKeyPublic: {
      type: "string",
      required: true,
      description: "Mailjet API key (public)",
      env: "MAILJET_API_KEY",
    },
    apiKeyPrivate: {
      type: "string",
      required: true,
      description: "Mailjet secret key (private)",
      env: "MAILJET_SECRET_KEY",
    },
    sandboxMode: {
      type: "boolean",
      required: false,
      description: "Enable sandbox mode (emails not actually sent)",
      default: false,
    },
    smsToken: {
      type: "string",
      required: false,
      description: "Mailjet SMS API token (if using SMS)",
      env: "MAILJET_SMS_TOKEN",
    },
  });

  rl.registerAction("email.send", {
    access: "write",
    description: "Send an email via Mailjet Send API v3.1",
    inputSchema: {
      fromEmail: { type: "string", required: true },
      fromName: { type: "string", required: false },
      toEmail: {
        type: "string",
        required: true,
        description: "Comma-separated recipient emails",
      },
      subject: { type: "string", required: true },
      htmlPart: { type: "string", required: false, description: "HTML body" },
      textPart: {
        type: "string",
        required: false,
        description: "Plain text body",
      },
      cc: {
        type: "string",
        required: false,
        description: "Comma-separated CC emails",
      },
      bcc: {
        type: "string",
        required: false,
        description: "Comma-separated BCC emails",
      },
      replyTo: {
        type: "string",
        required: false,
        description: "Reply-to email",
      },
      variables: {
        type: "object",
        required: false,
        description: "Template variables as key-value pairs",
      },
      trackOpens: {
        type: "string",
        required: false,
        description: "account_default, disabled, enabled",
      },
      trackClicks: {
        type: "string",
        required: false,
        description: "account_default, disabled, enabled",
      },
      templateLanguage: {
        type: "boolean",
        required: false,
        description: "Enable template language in body",
      },
      priority: {
        type: "number",
        required: false,
        description: "1-4, lower is higher priority",
      },
      customCampaign: { type: "string", required: false },
      deduplicateCampaign: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const message: Record<string, unknown> = {
        From: {
          Email: p.fromEmail,
          ...(p.fromName ? { Name: p.fromName } : {}),
        },
        Subject: p.subject,
        To: (p.toEmail as string).split(",").map((e) => ({ Email: e.trim() })),
      };
      if (p.htmlPart) message.HTMLPart = p.htmlPart;
      if (p.textPart) message.TextPart = p.textPart;
      if (p.cc)
        message.Cc = (p.cc as string)
          .split(",")
          .map((e) => ({ Email: e.trim() }));
      if (p.bcc)
        message.Bcc = (p.bcc as string)
          .split(",")
          .map((e) => ({ Email: e.trim() }));
      if (p.replyTo) message.ReplyTo = { Email: p.replyTo };
      if (p.variables) message.Variables = p.variables;
      if (p.trackOpens) message.TrackOpens = p.trackOpens;
      if (p.trackClicks) message.TrackClicks = p.trackClicks;
      if (p.templateLanguage !== undefined)
        message.TemplateLanguage = p.templateLanguage;
      if (p.priority) message.Priority = p.priority;
      if (p.customCampaign) message.CustomCampaign = p.customCampaign;
      if (p.deduplicateCampaign !== undefined)
        message.DeduplicateCampaign = p.deduplicateCampaign;

      return sendMessage(ctx, message);
    },
  });

  rl.registerAction("email.sendTemplate", {
    access: "write",
    description: "Send an email using a Mailjet template",
    inputSchema: {
      fromEmail: { type: "string", required: true },
      fromName: { type: "string", required: false },
      toEmail: {
        type: "string",
        required: true,
        description: "Comma-separated recipient emails",
      },
      subject: { type: "string", required: true },
      templateId: {
        type: "number",
        required: true,
        description: "Mailjet template ID",
      },
      variables: {
        type: "object",
        required: false,
        description: "Template variables",
      },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      replyTo: { type: "string", required: false },
      trackOpens: { type: "string", required: false },
      trackClicks: { type: "string", required: false },
      templateLanguage: { type: "boolean", required: false },
      priority: { type: "number", required: false },
      customCampaign: { type: "string", required: false },
      deduplicateCampaign: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const message: Record<string, unknown> = {
        From: {
          Email: p.fromEmail,
          ...(p.fromName ? { Name: p.fromName } : {}),
        },
        Subject: p.subject,
        To: (p.toEmail as string).split(",").map((e) => ({ Email: e.trim() })),
        TemplateID: p.templateId,
      };
      if (p.variables) message.Variables = p.variables;
      if (p.cc)
        message.Cc = (p.cc as string)
          .split(",")
          .map((e) => ({ Email: e.trim() }));
      if (p.bcc)
        message.Bcc = (p.bcc as string)
          .split(",")
          .map((e) => ({ Email: e.trim() }));
      if (p.replyTo) message.ReplyTo = { Email: p.replyTo };
      if (p.trackOpens) message.TrackOpens = p.trackOpens;
      if (p.trackClicks) message.TrackClicks = p.trackClicks;
      if (p.templateLanguage !== undefined)
        message.TemplateLanguage = p.templateLanguage;
      if (p.priority) message.Priority = p.priority;
      if (p.customCampaign) message.CustomCampaign = p.customCampaign;
      if (p.deduplicateCampaign !== undefined)
        message.DeduplicateCampaign = p.deduplicateCampaign;

      return sendMessage(ctx, message);
    },
  });

  rl.registerAction("sms.send", {
    access: "write",
    description: "Send an SMS via Mailjet SMS API",
    inputSchema: {
      from: {
        type: "string",
        required: true,
        description: "Sender name or number",
      },
      to: {
        type: "string",
        required: true,
        description: "Recipient phone number (international format)",
      },
      text: { type: "string", required: true, description: "SMS message text" },
    },
    async execute(input, ctx) {
      const { from, to, text } = input as Record<string, unknown>;
      return credentialJson(ctx, mailjetCredential, "mailjet", {
        target: "sms",
        path: "sms-send",
        method: "POST",
        json: { From: from, To: to, Text: text },
      });
    },
  });
}
