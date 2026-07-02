import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.stripe.com/v1";

async function apiRequest(
  secretKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${secretKey}` },
  };
  if (body && Object.keys(body).length > 0) {
    const form = new URLSearchParams();
    function flatten(obj: Record<string, unknown>, prefix = "") {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (
          v !== null &&
          v !== undefined &&
          typeof v === "object" &&
          !Array.isArray(v)
        ) {
          flatten(v as Record<string, unknown>, key);
        } else if (v !== null && v !== undefined) {
          form.set(key, String(v));
        }
      }
    }
    flatten(body);
    init.body = form;
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/x-www-form-urlencoded";
  }
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Stripe error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function stripe(rl: RunlinePluginAPI) {
  rl.setName("stripe");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    secretKey: {
      type: "string",
      required: true,
      description: "Stripe secret API key",
      env: "STRIPE_SECRET_KEY",
    },
  });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.secretKey as string;

  // ── Balance ─────────────────────────────────────────

  rl.registerAction("balance.get", {
    access: "read",
    description: "Get current balance",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(key(ctx), "GET", "/balance");
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
        key(ctx),
        "POST",
        "/customers",
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
        key(ctx),
        "GET",
        `/customers/${(input as Record<string, unknown>).customerId}`,
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
        key(ctx),
        "GET",
        "/customers",
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
      return apiRequest(key(ctx), "POST", `/customers/${customerId}`, fields);
    },
  });

  rl.registerAction("customer.delete", {
    access: "write",
    description: "Delete a customer",
    inputSchema: { customerId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "DELETE",
        `/customers/${(input as Record<string, unknown>).customerId}`,
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
        key(ctx),
        "POST",
        "/charges",
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
        key(ctx),
        "GET",
        `/charges/${(input as Record<string, unknown>).chargeId}`,
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
        key(ctx),
        "GET",
        "/charges",
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
      return apiRequest(key(ctx), "POST", `/charges/${chargeId}`, fields);
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
      return apiRequest(key(ctx), "POST", "/coupons", body);
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
        key(ctx),
        "GET",
        "/coupons",
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
        key(ctx),
        "POST",
        `/customers/${p.customerId}/sources`,
        { source: p.token },
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
        key(ctx),
        "GET",
        `/customers/${p.customerId}/sources/${p.sourceId}`,
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
        key(ctx),
        "DELETE",
        `/customers/${p.customerId}/sources/${p.cardId}`,
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
      const source = (await apiRequest(key(ctx), "POST", "/sources", {
        type: p.type,
        amount: p.amount,
        currency: p.currency,
      })) as Record<string, unknown>;
      await apiRequest(key(ctx), "POST", `/customers/${p.customerId}/sources`, {
        source: source.id,
      });
      return source;
    },
  });

  rl.registerAction("source.get", {
    access: "read",
    description: "Get a source by ID",
    inputSchema: { sourceId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `/sources/${(input as Record<string, unknown>).sourceId}`,
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
        key(ctx),
        "DELETE",
        `/customers/${p.customerId}/sources/${p.sourceId}`,
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
      return apiRequest(key(ctx), "POST", "/tokens", {
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
      return apiRequest(key(ctx), "POST", "/billing/meter_events", body);
    },
  });
}
