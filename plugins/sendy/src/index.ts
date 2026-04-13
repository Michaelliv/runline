import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { url: (c.url as string).replace(/\/$/, ""), apiKey: c.apiKey as string };
}

async function apiRequest(
  conn: { url: string; apiKey: string }, endpoint: string, body: Record<string, unknown>,
): Promise<string> {
  body.api_key = conn.apiKey;
  body.boolean = true;
  const formBody = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(`${conn.url}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody,
  });
  if (!res.ok) throw new Error(`Sendy error ${res.status}: ${await res.text()}`);
  return res.text();
}

export default function sendy(rl: RunlinePluginAPI) {
  rl.setName("sendy");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Sendy installation URL", env: "SENDY_URL" },
    apiKey: { type: "string", required: true, description: "Sendy API key", env: "SENDY_API_KEY" },
  });

  rl.registerAction("campaign.create", {
    description: "Create (and optionally send) an email campaign",
    inputSchema: {
      fromName: { type: "string", required: true },
      fromEmail: { type: "string", required: true },
      replyTo: { type: "string", required: true },
      title: { type: "string", required: true },
      subject: { type: "string", required: true },
      htmlText: { type: "string", required: true, description: "HTML content of the email" },
      sendCampaign: { type: "boolean", required: false, description: "Send immediately (default false)" },
      brandId: { type: "string", required: false, description: "Brand ID (required if not sending)" },
      listIds: { type: "string", required: false, description: "Comma-separated list IDs" },
      plainText: { type: "string", required: false },
      trackOpens: { type: "boolean", required: false },
      trackClicks: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        from_name: p.fromName, from_email: p.fromEmail, reply_to: p.replyTo,
        title: p.title, subject: p.subject, html_text: p.htmlText,
        send_campaign: p.sendCampaign ? 1 : 0,
      };
      if (p.brandId) body.brand_id = p.brandId;
      if (p.listIds) body.list_ids = p.listIds;
      if (p.plainText) body.plain_text = p.plainText;
      if (p.trackOpens !== undefined) body.track_opens = p.trackOpens ? 1 : 0;
      if (p.trackClicks !== undefined) body.track_clicks = p.trackClicks ? 1 : 0;
      const resp = await apiRequest(getConn(ctx), "/api/campaigns/create.php", body);
      if (resp.includes("Campaign created")) return { message: resp };
      throw new Error(`Sendy campaign error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.add", {
    description: "Add a subscriber to a list",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
      name: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email: p.email, list: p.listId };
      if (p.name) body.name = p.name;
      const resp = await apiRequest(getConn(ctx), "/subscribe", body);
      if (resp === "1") return { success: true };
      throw new Error(`Sendy subscribe error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.count", {
    description: "Get active subscriber count for a list",
    inputSchema: { listId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { listId } = input as Record<string, unknown>;
      const resp = await apiRequest(getConn(ctx), "/api/subscribers/active-subscriber-count.php", { list_id: listId });
      if (/^\d+$/.test(resp)) return { count: parseInt(resp, 10) };
      throw new Error(`Sendy count error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.delete", {
    description: "Delete a subscriber from a list",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(getConn(ctx), "/api/subscribers/delete.php", { email, list_id: listId });
      if (resp === "1") return { success: true };
      throw new Error(`Sendy delete error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.unsubscribe", {
    description: "Unsubscribe an email from a list",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(getConn(ctx), "/unsubscribe", { email, list: listId });
      if (resp === "1") return { success: true };
      throw new Error(`Sendy unsubscribe error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.status", {
    description: "Get subscription status of an email",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(getConn(ctx), "/api/subscribers/subscription-status.php", { email, list_id: listId });
      const valid = ["Subscribed", "Unsubscribed", "Unconfirmed", "Bounced", "Soft bounced", "Complained"];
      if (valid.includes(resp)) return { status: resp };
      throw new Error(`Sendy status error: ${resp}`);
    },
  });
}
