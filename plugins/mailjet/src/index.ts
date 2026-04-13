import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.mailjet.com";

export default function mailjet(rl: RunlinePluginAPI) {
  rl.setName("mailjet");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKeyPublic: { type: "string", required: true, description: "Mailjet API key (public)", env: "MAILJET_API_KEY" },
    apiKeyPrivate: { type: "string", required: true, description: "Mailjet secret key (private)", env: "MAILJET_SECRET_KEY" },
    sandboxMode: { type: "boolean", required: false, description: "Enable sandbox mode (emails not actually sent)", default: false },
    smsToken: { type: "string", required: false, description: "Mailjet SMS API token (if using SMS)", env: "MAILJET_SMS_TOKEN" },
  });

  const emailAuth = (ctx: { connection: { config: Record<string, unknown> } }) =>
    `Basic ${btoa(`${ctx.connection.config.apiKeyPublic}:${ctx.connection.config.apiKeyPrivate}`)}`;
  const sandbox = (ctx: { connection: { config: Record<string, unknown> } }) =>
    (ctx.connection.config.sandboxMode as boolean) ?? false;

  rl.registerAction("email.send", {
    description: "Send an email via Mailjet Send API v3.1",
    inputSchema: {
      fromEmail: { type: "string", required: true },
      fromName: { type: "string", required: false },
      toEmail: { type: "string", required: true, description: "Comma-separated recipient emails" },
      subject: { type: "string", required: true },
      htmlPart: { type: "string", required: false, description: "HTML body" },
      textPart: { type: "string", required: false, description: "Plain text body" },
      cc: { type: "string", required: false, description: "Comma-separated CC emails" },
      bcc: { type: "string", required: false, description: "Comma-separated BCC emails" },
      replyTo: { type: "string", required: false, description: "Reply-to email" },
      variables: { type: "object", required: false, description: "Template variables as key-value pairs" },
      trackOpens: { type: "string", required: false, description: "account_default, disabled, enabled" },
      trackClicks: { type: "string", required: false, description: "account_default, disabled, enabled" },
      templateLanguage: { type: "boolean", required: false, description: "Enable template language in body" },
      priority: { type: "number", required: false, description: "1-4, lower is higher priority" },
      customCampaign: { type: "string", required: false },
      deduplicateCampaign: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const message: Record<string, unknown> = {
        From: { Email: p.fromEmail, ...(p.fromName ? { Name: p.fromName } : {}) },
        Subject: p.subject,
        To: (p.toEmail as string).split(",").map((e) => ({ Email: e.trim() })),
      };
      if (p.htmlPart) message.HTMLPart = p.htmlPart;
      if (p.textPart) message.TextPart = p.textPart;
      if (p.cc) message.Cc = (p.cc as string).split(",").map((e) => ({ Email: e.trim() }));
      if (p.bcc) message.Bcc = (p.bcc as string).split(",").map((e) => ({ Email: e.trim() }));
      if (p.replyTo) message.ReplyTo = { Email: p.replyTo };
      if (p.variables) message.Variables = p.variables;
      if (p.trackOpens) message.TrackOpens = p.trackOpens;
      if (p.trackClicks) message.TrackClicks = p.trackClicks;
      if (p.templateLanguage !== undefined) message.TemplateLanguage = p.templateLanguage;
      if (p.priority) message.Priority = p.priority;
      if (p.customCampaign) message.CustomCampaign = p.customCampaign;
      if (p.deduplicateCampaign !== undefined) message.DeduplicateCampaign = p.deduplicateCampaign;

      const res = await fetch(`${BASE_URL}/v3.1/send`, {
        method: "POST",
        headers: { Authorization: emailAuth(ctx), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ Messages: [message], SandboxMode: sandbox(ctx) }),
      });
      if (!res.ok) throw new Error(`Mailjet API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.Messages;
    },
  });

  rl.registerAction("email.sendTemplate", {
    description: "Send an email using a Mailjet template",
    inputSchema: {
      fromEmail: { type: "string", required: true },
      fromName: { type: "string", required: false },
      toEmail: { type: "string", required: true, description: "Comma-separated recipient emails" },
      subject: { type: "string", required: true },
      templateId: { type: "number", required: true, description: "Mailjet template ID" },
      variables: { type: "object", required: false, description: "Template variables" },
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
        From: { Email: p.fromEmail, ...(p.fromName ? { Name: p.fromName } : {}) },
        Subject: p.subject,
        To: (p.toEmail as string).split(",").map((e) => ({ Email: e.trim() })),
        TemplateID: p.templateId,
      };
      if (p.variables) message.Variables = p.variables;
      if (p.cc) message.Cc = (p.cc as string).split(",").map((e) => ({ Email: e.trim() }));
      if (p.bcc) message.Bcc = (p.bcc as string).split(",").map((e) => ({ Email: e.trim() }));
      if (p.replyTo) message.ReplyTo = { Email: p.replyTo };
      if (p.trackOpens) message.TrackOpens = p.trackOpens;
      if (p.trackClicks) message.TrackClicks = p.trackClicks;
      if (p.templateLanguage !== undefined) message.TemplateLanguage = p.templateLanguage;
      if (p.priority) message.Priority = p.priority;
      if (p.customCampaign) message.CustomCampaign = p.customCampaign;
      if (p.deduplicateCampaign !== undefined) message.DeduplicateCampaign = p.deduplicateCampaign;

      const res = await fetch(`${BASE_URL}/v3.1/send`, {
        method: "POST",
        headers: { Authorization: emailAuth(ctx), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ Messages: [message], SandboxMode: sandbox(ctx) }),
      });
      if (!res.ok) throw new Error(`Mailjet API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as Record<string, unknown>;
      return data.Messages;
    },
  });

  rl.registerAction("sms.send", {
    description: "Send an SMS via Mailjet SMS API",
    inputSchema: {
      from: { type: "string", required: true, description: "Sender name or number" },
      to: { type: "string", required: true, description: "Recipient phone number (international format)" },
      text: { type: "string", required: true, description: "SMS message text" },
    },
    async execute(input, ctx) {
      const { from, to, text } = input as Record<string, unknown>;
      const smsToken = ctx.connection.config.smsToken as string;
      if (!smsToken) throw new Error("SMS token not configured — set smsToken in connection config");
      const res = await fetch(`${BASE_URL}/v4/sms-send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${smsToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ From: from, To: to, Text: text }),
      });
      if (!res.ok) throw new Error(`Mailjet SMS error ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
