import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://mandrillapp.com/api/1.0";

async function apiRequest(apiKey: string, endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
  body.key = apiKey;
  const res = await fetch(`${BASE_URL}${endpoint}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mandrill API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function mandrill(rl: RunlinePluginAPI) {
  rl.setName("mandrill");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Mandrill API key", env: "MANDRILL_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  function buildMessage(p: Record<string, unknown>): Record<string, unknown> {
    const message: Record<string, unknown> = {
      from_email: p.fromEmail,
      to: (p.toEmail as string).split(",").map((e) => ({ email: e.trim(), type: "to" })),
    };
    if (p.fromName) message.from_name = p.fromName;
    if (p.subject) message.subject = p.subject;
    if (p.html) message.html = p.html;
    if (p.text) message.text = p.text;
    if (p.bccAddress) message.bcc_address = p.bccAddress;
    if (p.tags) message.tags = (p.tags as string).split(",").map((t) => t.trim());
    if (p.subaccount) message.subaccount = p.subaccount;
    if (p.trackOpens !== undefined) message.track_opens = p.trackOpens;
    if (p.trackClicks !== undefined) message.track_clicks = p.trackClicks;
    if (p.autoText !== undefined) message.auto_text = p.autoText;
    if (p.autoHtml !== undefined) message.auto_html = p.autoHtml;
    if (p.inlineCss !== undefined) message.inline_css = p.inlineCss;
    if (p.important !== undefined) message.important = p.important;
    if (p.preserveRecipients !== undefined) message.preserve_recipients = p.preserveRecipients;
    if (p.urlStripQs !== undefined) message.url_strip_qs = p.urlStripQs;
    if (p.viewContentLink !== undefined) message.view_content_link = p.viewContentLink;
    if (p.async !== undefined) message.async = p.async;
    if (p.ipPool) message.ip_pool = p.ipPool;
    if (p.trackingDomain) message.tracking_domain = p.trackingDomain;
    if (p.signingDomain) message.signing_domain = p.signingDomain;
    if (p.returnPathDomain) message.return_path_domain = p.returnPathDomain;
    if (p.googleAnalyticsCampaign) message.google_analytics_campaign = p.googleAnalyticsCampaign;
    if (p.googleAnalyticsDomains) message.google_analytics_domains = (p.googleAnalyticsDomains as string).split(",").map((d) => d.trim());
    if (p.mergeVars) message.global_merge_vars = p.mergeVars;
    if (p.metadata) message.metadata = p.metadata;
    if (p.headers) message.headers = p.headers;
    if (p.attachments) message.attachments = p.attachments;
    return message;
  }

  const messageInputSchema = {
    fromEmail: { type: "string" as const, required: true },
    toEmail: { type: "string" as const, required: true, description: "Comma-separated recipient emails" },
    fromName: { type: "string" as const, required: false },
    subject: { type: "string" as const, required: false },
    html: { type: "string" as const, required: false, description: "HTML body" },
    text: { type: "string" as const, required: false, description: "Plain text body" },
    bccAddress: { type: "string" as const, required: false },
    tags: { type: "string" as const, required: false, description: "Comma-separated tags" },
    subaccount: { type: "string" as const, required: false },
    trackOpens: { type: "boolean" as const, required: false },
    trackClicks: { type: "boolean" as const, required: false },
    autoText: { type: "boolean" as const, required: false },
    autoHtml: { type: "boolean" as const, required: false },
    inlineCss: { type: "boolean" as const, required: false },
    important: { type: "boolean" as const, required: false },
    preserveRecipients: { type: "boolean" as const, required: false },
    urlStripQs: { type: "boolean" as const, required: false },
    viewContentLink: { type: "boolean" as const, required: false },
    async: { type: "boolean" as const, required: false },
    ipPool: { type: "string" as const, required: false },
    trackingDomain: { type: "string" as const, required: false },
    signingDomain: { type: "string" as const, required: false },
    returnPathDomain: { type: "string" as const, required: false },
    googleAnalyticsCampaign: { type: "string" as const, required: false },
    googleAnalyticsDomains: { type: "string" as const, required: false, description: "Comma-separated domains" },
    mergeVars: { type: "array" as const, required: false, description: "Array of {name, content} objects" },
    metadata: { type: "object" as const, required: false, description: "Key-value metadata" },
    headers: { type: "object" as const, required: false, description: "Extra headers" },
    attachments: { type: "array" as const, required: false, description: "Array of {type, name, content} (content is base64)" },
    sendAt: { type: "string" as const, required: false, description: "UTC datetime YYYY-MM-DD HH:mm:ss" },
  };

  rl.registerAction("message.sendHtml", {
    description: "Send an email with HTML/text content via Mandrill",
    inputSchema: messageInputSchema,
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        message: buildMessage(p),
        template_content: [],
      };
      if (p.sendAt) body.send_at = p.sendAt;
      return apiRequest(key(ctx), "/messages/send", body);
    },
  });

  rl.registerAction("message.sendTemplate", {
    description: "Send an email using a Mandrill template",
    inputSchema: {
      templateName: { type: "string", required: true, description: "Template slug" },
      ...messageInputSchema,
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        template_name: p.templateName,
        template_content: [],
        message: buildMessage(p),
      };
      if (p.sendAt) body.send_at = p.sendAt;
      return apiRequest(key(ctx), "/messages/send-template", body);
    },
  });
}
