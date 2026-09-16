import type { ActionContext, RunlinePluginAPI } from "runline";
import {
  coordinatedAccessToken,
  requestToken,
} from "../../_shared/tokenRefresh.js";

function getConn(c: Readonly<Record<string, unknown>>) {
  const env = (c.env as string) ?? "sandbox";
  const base =
    env === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  return { base, clientId: c.clientId as string, secret: c.secret as string };
}

async function apiRequest(
  ctx: ActionContext,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const token = await coordinatedAccessToken(ctx, (current) => {
    const conn = getConn(current);
    return requestToken(
      {
        url: `${conn.base}/v1/oauth2/token`,
        clientAuthentication: "client_secret_basic",
      },
      { grant_type: "client_credentials" },
      { clientId: conn.clientId, clientSecret: conn.secret },
    );
  });
  const url = new URL(`${getConn(ctx.connection.config).base}/v1${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`PayPal API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function paypal(rl: RunlinePluginAPI) {
  rl.setName("paypal");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: true,
      description: "PayPal client ID",
      env: "PAYPAL_CLIENT_ID",
    },
    secret: {
      type: "string",
      required: true,
      description: "PayPal secret",
      env: "PAYPAL_SECRET",
    },
    env: {
      type: "string",
      required: false,
      description: "live or sandbox (default sandbox)",
      env: "PAYPAL_ENV",
    },
  });

  rl.registerAction("payout.create", {
    access: "write",
    description: "Create a batch payout",
    inputSchema: {
      senderBatchId: {
        type: "string",
        required: true,
        description: "Unique batch ID",
      },
      items: {
        type: "object",
        required: true,
        description:
          "Array of payout items [{receiver, amount: {value, currency}, recipient_type, note}]",
      },
      emailSubject: { type: "string", required: false },
      emailMessage: { type: "string", required: false },
      note: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const header: Record<string, unknown> = {
        sender_batch_id: p.senderBatchId,
      };
      if (p.emailSubject) header.email_subject = p.emailSubject;
      if (p.emailMessage) header.email_message = p.emailMessage;
      if (p.note) header.note = p.note;
      return apiRequest(ctx, "POST", "/payments/payouts", {
        sender_batch_header: header,
        items: p.items,
      });
    },
  });

  rl.registerAction("payout.get", {
    access: "read",
    description: "Get a batch payout by ID (returns items)",
    inputSchema: {
      payoutBatchId: { type: "string", required: true },
      limit: {
        type: "number",
        required: false,
        description: "Max items to return",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.page_size = p.limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        `/payments/payouts/${p.payoutBatchId}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.items;
    },
  });

  rl.registerAction("payoutItem.get", {
    access: "read",
    description: "Get a payout item by ID",
    inputSchema: { payoutItemId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { payoutItemId } = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `/payments/payouts-item/${payoutItemId}`);
    },
  });

  rl.registerAction("payoutItem.cancel", {
    access: "write",
    description: "Cancel an unclaimed payout item",
    inputSchema: { payoutItemId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { payoutItemId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `/payments/payouts-item/${payoutItemId}/cancel`,
      );
    },
  });
}
