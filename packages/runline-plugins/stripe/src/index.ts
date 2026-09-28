import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { stripeCredential } from "./credentials.js";

/** Stripe's form keys for nested objects: `metadata[plan]`. */
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object" && !Array.isArray(v))
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, stripeCredential, "stripe", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { form: flatten(body) } : {}),
  });
}

export default function stripe(rl: RunlinePluginAPI) {
  rl.setName("stripe");
  rl.setVersion("0.1.0");
  rl.setCredential(stripeCredential);
  rl.setConnectionSchema({
    secretKey: {
      type: "string",
      required: true,
      description: "Stripe secret API key",
      env: "STRIPE_SECRET_KEY",
    },
  });
  // ── Balance ─────────────────────────────────────────

  rl.registerAction("balance.get", {
    access: "read",
    description: "Get current balance",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "balance");
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    access: "write",
    description: "Create a customer",
    inputSchema: {
      name: { type: "string", required: true },
      email: { type: "string", required: false },
      phone: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        "customers",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("customer.get", {
    access: "read",
    description: "Get a customer by ID",
    inputSchema: { customerId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `customers/${pathSegment((input as Record<string, unknown>).customerId)}`,
      );
    },
  });

  rl.registerAction("customer.list", {
    access: "read",
    description: "List customers",
    inputSchema: {
      limit: { type: "number", required: false },
      email: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.email) qs.email = p.email;
      const data = (await apiRequest(
        ctx,
        "GET",
        "customers",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("customer.update", {
    access: "write",
    description: "Update a customer",
    inputSchema: {
      customerId: { type: "string", required: true },
      name: { type: "string", required: false },
      email: { type: "string", required: false },
      phone: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { customerId, ...fields } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `customers/${pathSegment(customerId)}`,
        fields,
      );
    },
  });

  rl.registerAction("customer.delete", {
    access: "write",
    description: "Delete a customer",
    inputSchema: { customerId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `customers/${pathSegment((input as Record<string, unknown>).customerId)}`,
      );
    },
  });

  // ── Charge ──────────────────────────────────────────

  rl.registerAction("charge.create", {
    access: "write",
    description: "Create a charge",
    inputSchema: {
      amount: {
        type: "number",
        required: true,
        description: "Amount in smallest currency unit (e.g. cents)",
      },
      currency: { type: "string", required: true },
      source: {
        type: "string",
        required: true,
        description: "Payment source token or ID",
      },
      customer: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        "charges",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("charge.get", {
    access: "read",
    description: "Get a charge by ID",
    inputSchema: { chargeId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `charges/${pathSegment((input as Record<string, unknown>).chargeId)}`,
      );
    },
  });

  rl.registerAction("charge.list", {
    access: "read",
    description: "List charges",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        "charges",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("charge.update", {
    access: "write",
    description: "Update a charge",
    inputSchema: {
      chargeId: { type: "string", required: true },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { chargeId, ...fields } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `charges/${pathSegment(chargeId)}`,
        fields,
      );
    },
  });

  // ── Coupon ──────────────────────────────────────────

  rl.registerAction("coupon.create", {
    access: "write",
    description: "Create a coupon",
    inputSchema: {
      duration: {
        type: "string",
        required: true,
        description: "forever, once, or repeating",
      },
      percentOff: { type: "number", required: false },
      amountOff: {
        type: "number",
        required: false,
        description: "In smallest currency unit",
      },
      currency: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { duration: p.duration };
      if (p.percentOff) body.percent_off = p.percentOff;
      if (p.amountOff) body.amount_off = p.amountOff;
      if (p.currency) body.currency = p.currency;
      return apiRequest(ctx, "POST", "coupons", body);
    },
  });

  rl.registerAction("coupon.list", {
    access: "read",
    description: "List coupons",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        "coupons",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  // ── Customer Card ───────────────────────────────────

  rl.registerAction("customerCard.add", {
    access: "write",
    description: "Add a card to a customer",
    inputSchema: {
      customerId: { type: "string", required: true },
      token: {
        type: "string",
        required: true,
        description: "Card token from Stripe.js/Elements",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `customers/${pathSegment(p.customerId)}/sources`,
        {
          source: p.token,
        },
      );
    },
  });

  rl.registerAction("customerCard.get", {
    access: "read",
    description: "Get a customer's card/source",
    inputSchema: {
      customerId: { type: "string", required: true },
      sourceId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `customers/${pathSegment(p.customerId)}/sources/${pathSegment(p.sourceId)}`,
      );
    },
  });

  rl.registerAction("customerCard.remove", {
    access: "write",
    description: "Remove a card from a customer",
    inputSchema: {
      customerId: { type: "string", required: true },
      cardId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `customers/${pathSegment(p.customerId)}/sources/${pathSegment(p.cardId)}`,
      );
    },
  });

  // ── Source ──────────────────────────────────────────

  rl.registerAction("source.create", {
    access: "write",
    description: "Create a source and attach to customer",
    inputSchema: {
      customerId: { type: "string", required: true },
      type: { type: "string", required: true },
      amount: { type: "number", required: true },
      currency: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const source = (await apiRequest(ctx, "POST", "sources", {
        type: p.type,
        amount: p.amount,
        currency: p.currency,
      })) as Record<string, unknown>;
      await apiRequest(
        ctx,
        "POST",
        `customers/${pathSegment(p.customerId)}/sources`,
        {
          source: source.id,
        },
      );
      return source;
    },
  });

  rl.registerAction("source.get", {
    access: "read",
    description: "Get a source by ID",
    inputSchema: { sourceId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `sources/${pathSegment((input as Record<string, unknown>).sourceId)}`,
      );
    },
  });

  rl.registerAction("source.delete", {
    access: "write",
    description: "Detach a source from a customer",
    inputSchema: {
      customerId: { type: "string", required: true },
      sourceId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `customers/${pathSegment(p.customerId)}/sources/${pathSegment(p.sourceId)}`,
      );
    },
  });

  // ── Token ───────────────────────────────────────────

  rl.registerAction("token.createCard", {
    access: "write",
    description: "Create a card token",
    inputSchema: {
      number: { type: "string", required: true },
      expMonth: { type: "number", required: true },
      expYear: { type: "number", required: true },
      cvc: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "tokens", {
        card: {
          number: p.number,
          exp_month: p.expMonth,
          exp_year: p.expYear,
          cvc: p.cvc,
        },
      });
    },
  });

  // ── Meter Event ─────────────────────────────────────

  rl.registerAction("meterEvent.create", {
    access: "write",
    description: "Create a billing meter event",
    inputSchema: {
      eventName: { type: "string", required: true },
      customerId: { type: "string", required: true },
      value: { type: "number", required: true },
      identifier: { type: "string", required: false },
      timestamp: {
        type: "string",
        required: false,
        description: "ISO datetime",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        event_name: p.eventName,
        payload: { stripe_customer_id: p.customerId, value: p.value },
      };
      if (p.identifier) body.identifier = p.identifier;
      if (p.timestamp)
        body.timestamp = Math.floor(
          new Date(p.timestamp as string).getTime() / 1000,
        );
      return apiRequest(ctx, "POST", "billing/meter_events", body);
    },
  });
}
