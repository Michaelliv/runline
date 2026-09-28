import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { paypalCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, paypalCredential, "paypal", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function paypal(rl: RunlinePluginAPI) {
  rl.setName("paypal");
  rl.setVersion("0.1.0");
  rl.setCredential(paypalCredential);

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
      return apiRequest(ctx, "POST", "payments/payouts", {
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
        `payments/payouts/${seg(p.payoutBatchId)}`,
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
      return apiRequest(
        ctx,
        "GET",
        `payments/payouts-item/${seg(payoutItemId)}`,
      );
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
        `payments/payouts-item/${seg(payoutItemId)}/cancel`,
      );
    },
  });
}
