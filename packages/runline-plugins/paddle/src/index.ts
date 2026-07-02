import type { RunlinePluginAPI } from "runline";

interface Conn {
  config: Record<string, unknown>;
}

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  const sandbox = c.sandbox as boolean | undefined;
  const base = sandbox
    ? "https://sandbox-vendors.paddle.com/api"
    : "https://vendors.paddle.com/api";
  return {
    base,
    vendorId: c.vendorId as string,
    vendorAuthCode: c.vendorAuthCode as string,
  };
}

async function apiRequest(
  conn: { base: string; vendorId: string; vendorAuthCode: string },
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  body.vendor_id = conn.vendorId;
  body.vendor_auth_code = conn.vendorAuthCode;
  const res = await fetch(`${conn.base}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Paddle API error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (!json.success)
    throw new Error(`Paddle API error: ${JSON.stringify(json.error ?? json)}`);
  return json.response;
}

async function paginate(
  conn: { base: string; vendorId: string; vendorAuthCode: string },
  endpoint: string,
  body: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  body.results_per_page = 200;
  body.page = 1;
  let items: unknown[];
  do {
    const resp = await apiRequest(conn, endpoint, { ...body });
    items = Array.isArray(resp) ? resp : [];
    all.push(...items);
    body.page = (body.page as number) + 1;
  } while (items.length === 200);
  return all;
}

export default function paddle(rl: RunlinePluginAPI) {
  rl.setName("paddle");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    vendorId: {
      type: "string",
      required: true,
      description: "Paddle Vendor ID",
      env: "PADDLE_VENDOR_ID",
    },
    vendorAuthCode: {
      type: "string",
      required: true,
      description: "Paddle Vendor Auth Code",
      env: "PADDLE_VENDOR_AUTH_CODE",
    },
    sandbox: {
      type: "boolean",
      required: false,
      description: "Use sandbox environment (default false)",
    },
  });

  // ── Coupon ──────────────────────────────────────────

  rl.registerAction("coupon.create", {
    access: "write",
    description: "Create a coupon",
    inputSchema: {
      couponType: {
        type: "string",
        required: true,
        description: "product or checkout",
      },
      discountType: {
        type: "string",
        required: true,
        description: "flat or percentage",
      },
      discountAmount: { type: "number", required: true },
      productIds: {
        type: "string",
        required: false,
        description: "Comma-separated product IDs (for product coupon type)",
      },
      currency: {
        type: "string",
        required: false,
        description: "Currency code (required for flat discount)",
      },
      allowedUses: { type: "number", required: false },
      couponCode: { type: "string", required: false },
      couponPrefix: { type: "string", required: false },
      expires: {
        type: "string",
        required: false,
        description: "Expiry date YYYY-MM-DD",
      },
      group: { type: "string", required: false },
      recurring: { type: "boolean", required: false },
      numberOfCoupons: { type: "number", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        coupon_type: p.couponType,
        discount_type: p.discountType,
        discount_amount: p.discountAmount,
      };
      if (p.productIds) body.product_ids = p.productIds;
      if (p.currency) body.currency = p.currency;
      if (p.allowedUses) body.allowed_uses = p.allowedUses;
      if (p.couponCode) body.coupon_code = p.couponCode;
      if (p.couponPrefix) body.coupon_prefix = p.couponPrefix;
      if (p.expires) body.expires = p.expires;
      if (p.group) body.group = p.group;
      if (p.recurring !== undefined) body.recurring = p.recurring ? 1 : 0;
      if (p.numberOfCoupons) body.num_coupons = p.numberOfCoupons;
      if (p.description) body.description = p.description;
      const resp = (await apiRequest(
        getConn(ctx),
        "/2.1/product/create_coupon",
        body,
      )) as Record<string, unknown>;
      return resp.coupon_codes;
    },
  });

  rl.registerAction("coupon.list", {
    access: "read",
    description: "List coupons for a product",
    inputSchema: {
      productId: { type: "string", required: true, description: "Product ID" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resp = (await apiRequest(
        getConn(ctx),
        "/2.0/product/list_coupons",
        { product_id: p.productId },
      )) as unknown[];
      if (p.limit) return resp.slice(0, p.limit as number);
      return resp;
    },
  });

  rl.registerAction("coupon.update", {
    access: "write",
    description: "Update a coupon by code or group",
    inputSchema: {
      couponCode: {
        type: "string",
        required: false,
        description: "Coupon code to update",
      },
      group: {
        type: "string",
        required: false,
        description: "Group name to update",
      },
      newCouponCode: { type: "string", required: false },
      newGroup: { type: "string", required: false },
      allowedUses: { type: "number", required: false },
      currency: { type: "string", required: false },
      discountAmount: { type: "number", required: false },
      expires: { type: "string", required: false },
      productIds: { type: "string", required: false },
      recurring: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.couponCode) body.coupon_code = p.couponCode;
      if (p.group) body.group = p.group;
      if (p.newCouponCode) body.new_coupon_code = p.newCouponCode;
      if (p.newGroup) body.new_group = p.newGroup;
      if (p.allowedUses) body.allowed_uses = p.allowedUses;
      if (p.currency) body.currency = p.currency;
      if (p.discountAmount) body.discount_amount = p.discountAmount;
      if (p.expires) body.expires = p.expires;
      if (p.productIds) body.product_ids = p.productIds;
      if (p.recurring !== undefined) body.recurring = p.recurring ? 1 : 0;
      return apiRequest(getConn(ctx), "/2.1/product/update_coupon", body);
    },
  });

  // ── Payment ─────────────────────────────────────────

  rl.registerAction("payment.list", {
    access: "read",
    description: "List subscription payments",
    inputSchema: {
      subscriptionId: { type: "number", required: false },
      plan: { type: "string", required: false },
      state: { type: "string", required: false },
      isPaid: { type: "boolean", required: false },
      from: { type: "string", required: false, description: "YYYY-MM-DD" },
      to: { type: "string", required: false, description: "YYYY-MM-DD" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.subscriptionId) body.subscription_id = p.subscriptionId;
      if (p.plan) body.plan = p.plan;
      if (p.state) body.state = p.state;
      if (p.isPaid !== undefined) body.is_paid = p.isPaid ? 1 : 0;
      if (p.from) body.from = p.from;
      if (p.to) body.to = p.to;
      const resp = (await apiRequest(
        getConn(ctx),
        "/2.0/subscription/payments",
        body,
      )) as unknown[];
      if (p.limit) return resp.slice(0, p.limit as number);
      return resp;
    },
  });

  rl.registerAction("payment.reschedule", {
    access: "write",
    description: "Reschedule a payment",
    inputSchema: {
      paymentId: { type: "number", required: true },
      date: {
        type: "string",
        required: true,
        description: "New payment date YYYY-MM-DD",
      },
    },
    async execute(input, ctx) {
      const { paymentId, date } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "/2.0/subscription/payments_reschedule", {
        payment_id: paymentId,
        date,
      });
    },
  });

  // ── Plan ────────────────────────────────────────────

  rl.registerAction("plan.get", {
    access: "read",
    description: "Get a subscription plan by ID",
    inputSchema: { planId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { planId } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "/2.0/subscription/plans", {
        plan: planId,
      });
    },
  });

  rl.registerAction("plan.list", {
    access: "read",
    description: "List all subscription plans",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const resp = (await apiRequest(
        getConn(ctx),
        "/2.0/subscription/plans",
      )) as unknown[];
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return resp.slice(0, limit as number);
      return resp;
    },
  });

  // ── Product ─────────────────────────────────────────

  rl.registerAction("product.list", {
    access: "read",
    description: "List all products",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const resp = (await apiRequest(
        getConn(ctx),
        "/2.0/product/get_products",
      )) as Record<string, unknown>;
      const products = (resp.products ?? resp) as unknown[];
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return products.slice(0, limit as number);
      return products;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.list", {
    access: "read",
    description: "List subscription users",
    inputSchema: {
      state: {
        type: "string",
        required: false,
        description: "active, past_due, trialing, paused, deleted",
      },
      planId: { type: "string", required: false },
      subscriptionId: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const conn = getConn(ctx);
      const body: Record<string, unknown> = {};
      if (p.state) body.state = p.state;
      if (p.planId) body.plan_id = p.planId;
      if (p.subscriptionId) body.subscription_id = p.subscriptionId;
      if (p.limit) {
        body.results_per_page = p.limit;
        return apiRequest(conn, "/2.0/subscription/users", body);
      }
      return paginate(conn, "/2.0/subscription/users", body);
    },
  });
}
