import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialOk } from "../../_shared/credentials.js";
import { sendyCredential } from "./credentials.js";

/** A Sendy form call; Sendy answers in plain text, `boolean` asking for 1 on success. */
async function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await credentialOk(ctx, sendyCredential, "sendy", {
    target: "api",
    path: endpoint,
    method: "POST",
    form: { ...body, boolean: true },
  });
  return res.text();
}

export default function sendy(rl: RunlinePluginAPI) {
  rl.setName("sendy");
  rl.setVersion("0.1.0");
  rl.setCredential(sendyCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Sendy installation URL",
      env: "SENDY_URL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Sendy API key",
      env: "SENDY_API_KEY",
    },
  });

  rl.registerAction("campaign.create", {
    access: "write",
    description: "Create (and optionally send) an email campaign",
    inputSchema: {
      fromName: { type: "string", required: true },
      fromEmail: { type: "string", required: true },
      replyTo: { type: "string", required: true },
      title: { type: "string", required: true },
      subject: { type: "string", required: true },
      htmlText: {
        type: "string",
        required: true,
        description: "HTML content of the email",
      },
      sendCampaign: {
        type: "boolean",
        required: false,
        description: "Send immediately (default false)",
      },
      brandId: {
        type: "string",
        required: false,
        description: "Brand ID (required if not sending)",
      },
      listIds: {
        type: "string",
        required: false,
        description: "Comma-separated list IDs",
      },
      plainText: { type: "string", required: false },
      trackOpens: { type: "boolean", required: false },
      trackClicks: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        from_name: p.fromName,
        from_email: p.fromEmail,
        reply_to: p.replyTo,
        title: p.title,
        subject: p.subject,
        html_text: p.htmlText,
        send_campaign: p.sendCampaign ? 1 : 0,
      };
      if (p.brandId) body.brand_id = p.brandId;
      if (p.listIds) body.list_ids = p.listIds;
      if (p.plainText) body.plain_text = p.plainText;
      if (p.trackOpens !== undefined) body.track_opens = p.trackOpens ? 1 : 0;
      if (p.trackClicks !== undefined)
        body.track_clicks = p.trackClicks ? 1 : 0;
      const resp = await apiRequest(ctx, "api/campaigns/create.php", body);
      if (resp.includes("Campaign created")) return { message: resp };
      throw new Error(`Sendy campaign error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.add", {
    access: "write",
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
      const resp = await apiRequest(ctx, "subscribe", body);
      if (resp === "1") return { success: true };
      throw new Error(`Sendy subscribe error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.count", {
    access: "read",
    description: "Get active subscriber count for a list",
    inputSchema: { listId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { listId } = input as Record<string, unknown>;
      const resp = await apiRequest(
        ctx,
        "api/subscribers/active-subscriber-count.php",
        { list_id: listId },
      );
      if (/^\d+$/.test(resp)) return { count: parseInt(resp, 10) };
      throw new Error(`Sendy count error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.delete", {
    access: "write",
    description: "Delete a subscriber from a list",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(ctx, "api/subscribers/delete.php", {
        email,
        list_id: listId,
      });
      if (resp === "1") return { success: true };
      throw new Error(`Sendy delete error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.unsubscribe", {
    access: "write",
    description: "Unsubscribe an email from a list",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(ctx, "unsubscribe", {
        email,
        list: listId,
      });
      if (resp === "1") return { success: true };
      throw new Error(`Sendy unsubscribe error: ${resp}`);
    },
  });

  rl.registerAction("subscriber.status", {
    access: "read",
    description: "Get subscription status of an email",
    inputSchema: {
      email: { type: "string", required: true },
      listId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { email, listId } = input as Record<string, unknown>;
      const resp = await apiRequest(
        ctx,
        "api/subscribers/subscription-status.php",
        { email, list_id: listId },
      );
      const valid = [
        "Subscribed",
        "Unsubscribed",
        "Unconfirmed",
        "Bounced",
        "Soft bounced",
        "Complained",
      ];
      if (valid.includes(resp)) return { status: resp };
      throw new Error(`Sendy status error: ${resp}`);
    },
  });
}
