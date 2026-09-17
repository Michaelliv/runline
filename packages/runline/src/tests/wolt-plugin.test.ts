import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import wolt from "../../../runline-plugins/wolt/src/index.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { createPluginAPI } from "../plugin/api.js";
import { isTypedInputSchema } from "../plugin/schema.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build(): PluginDef {
  const { api, resolve } = createPluginAPI("wolt");
  wolt(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected wolt.${name} to be registered`);
  return found;
}

const CONNECTED = {
  refreshToken: "refresh-1",
  accessToken: "access-1",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  deviceToken: "device-1",
  visitorId: "visitor-1",
  woltSessionId: "session-1",
  ravelinDeviceId: "rvnand-6-abc",
  paymentMethodId: "card-1",
};

async function context(config: Record<string, unknown> = {}) {
  const store = new MemoryConnectionProvider([
    { name: "account", plugin: "wolt", config: { ...CONNECTED, ...config } },
  ]);
  const handle = await store.resolve({ plugin: "wolt" });
  const connection = await handle.read();
  const ctx: ActionContext = {
    connection,
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      connection.config = (await handle.update(change)).config;
    },
  };
  return { ctx, handle };
}

interface Call {
  url: string;
  method: string;
  auth: string | null;
  redirect: RequestRedirect | undefined;
  body: string;
}

type Route = [string, unknown | (() => unknown)];

function mock(routes: Route[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      body: init?.body ? String(init.body) : "",
    });
    for (const [fragment, payload] of routes) {
      if (!url.includes(fragment)) continue;
      const value = typeof payload === "function" ? payload() : payload;
      if (value instanceof Response) return value;
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ unrouted: url }), { status: 404 });
  }) as typeof fetch;
  return calls;
}

/** Calls that reached the one endpoint which actually charges the card. */
function purchased(list: Call[]): Call[] {
  return list.filter((c) => new URL(c.url).pathname.endsWith("/v2/purchases"));
}

const ASSORTMENT = {
  assortment_id: "a1",
  selected_language: "en",
  categories: [{ id: "c1", name: "Mains", item_ids: ["i1"] }],
  items: [
    {
      id: "i1",
      name: "Ramen",
      price: 5200,
      checksum: "sum-1",
      options: [
        {
          id: "g1",
          option_id: "o1",
          multi_choice_config: { total_range: { min: 1, max: 1 } },
        },
      ],
    },
  ],
  options: [
    {
      id: "o1",
      name: "Spice",
      type: "Multichoice",
      values: [
        { id: "v1", name: "Mild", price: 0 },
        { id: "v2", name: "Hot", price: 300 },
      ],
    },
  ],
};

/** The whole chain an order walks: venue, addresses, assortment, checkout, purchase. */
function orderRoutes(
  payable = 6100,
  purchaseResponse: unknown = { results: [{ id: { $oid: "order-9" } }] },
): Route[] {
  return [
    [
      "/pages/venue/slug/",
      {
        venue: {
          id: "v1",
          slug: "sushi-bar",
          name: "Sushi Bar",
          country: "ISR",
          currency: "ILS",
          online: true,
        },
        order_minimum: 3000,
      },
    ],
    ["/venue/slug/", { venue: { online: true, estimate: 30 } }],
    [
      "/v2/delivery/info",
      {
        results: [
          {
            id: "addr-1",
            location: {
              address: "Dizengoff 1",
              city: "Tel Aviv",
              user_coordinates: { coordinates: [34.77, 32.08] },
            },
          },
        ],
      },
    ],
    ["consumer-assortment", ASSORTMENT],
    [
      "/pages/checkout",
      () => ({
        id: "checkout-1",
        payable_amount: payable,
        purchase_validation: { end_amount: payable, delivery_price: 900 },
        delivery_configs: [
          {
            method: "homedelivery",
            schedule: "standard",
            estimate: { min: 25, max: 40 },
          },
        ],
      }),
    ],
    ["/v2/purchases", purchaseResponse],
  ];
}

const CART = [
  { id: "i1", count: 1, options: [{ id: "g1", values: [{ id: "v2" }] }] },
];

describe("wolt plugin surface", () => {
  it("registers resource.verb actions with typed schemas and correct access", () => {
    assert.equal(plugin.name, "wolt");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "account.findPaymentMethod",
      "account.get",
      "account.loginMethods",
      "account.redeemLink",
      "account.refresh",
      "account.requestEmailCode",
      "account.requestSmsCode",
      "account.status",
      "account.submitCode",
      "account.submitConfirmation",
      "address.list",
      "item.get",
      "menu.get",
      "order.cancel",
      "order.create",
      "order.estimate",
      "order.status",
      "venue.get",
      "venue.listNearby",
      "venue.search",
    ]);
    assert.deepEqual(
      plugin.actions
        .filter((a) => a.access === "write")
        .map((a) => a.name)
        .sort(),
      [
        "account.findPaymentMethod",
        "account.redeemLink",
        "account.refresh",
        "account.requestEmailCode",
        "account.requestSmsCode",
        "account.submitCode",
        "account.submitConfirmation",
        "order.cancel",
        "order.create",
      ],
    );
    for (const a of plugin.actions) {
      assert.ok(
        isTypedInputSchema(a.inputSchema),
        `${a.name} must use TypeBox`,
      );
    }
    assert.ok(isTypedInputSchema(plugin.connectionConfigSchema));
  });

  it("describes the cart as a real shape rather than an opaque JSON string", () => {
    const schema = action("order.create").inputSchema as TSchema;
    // A malformed cart is a schema error before anything can be charged.
    assert.equal(Check(schema, { slug: "s", items: [] }), false);
    assert.equal(Check(schema, { slug: "s", items: "[]" }), false);
    assert.equal(
      Check(schema, { slug: "s", items: [{ id: "i1", count: 0 }] }),
      false,
    );
    assert.equal(
      Check(schema, {
        slug: "s",
        items: [{ id: "i1", options: [{ id: "g1", values: [] }] }],
      }),
      false,
    );
    assert.equal(
      Check(schema, { slug: "s", items: CART, confirm: true, quote: "q_x" }),
      true,
    );
  });

  it("rejects malformed and unknown input before any request", () => {
    globalThis.fetch = (async () => {
      throw new Error("must not reach the network");
    }) as typeof fetch;
    const invalid: Array<[string, unknown]> = [
      ["venue.search", {}],
      ["venue.search", { query: "x", surprise: 1 }],
      ["venue.search", { query: "x", lat: 999 }],
      ["menu.get", { slug: "s", limit: -1 }],
      ["item.get", { slug: "s" }],
      ["account.submitCode", {}],
      ["account.redeemLink", { link: "" }],
      ["order.cancel", { order_id: "o", reason: "" }],
      ["order.create", { slug: "s" }],
      ["order.status", {}],
    ];
    for (const [name, input] of invalid) {
      assert.equal(
        Check(action(name).inputSchema as TSchema, input),
        false,
        `${name} should reject ${JSON.stringify(input)}`,
      );
    }
  });

  it("reads the catalogue anonymously, with no bearer and no login", async () => {
    const { ctx } = await context({
      refreshToken: undefined,
      accessToken: undefined,
    });
    const calls = mock([
      [
        "/v1/pages/search",
        {
          sections: [
            {
              items: [
                {
                  venue: {
                    id: "v1",
                    slug: "sushi-bar",
                    name: "Sushi Bar",
                    online: true,
                    rating: { score: 9.1 },
                  },
                },
              ],
            },
          ],
        },
      ],
    ]);
    const r = (await action("venue.search").execute(
      { query: "sushi" },
      ctx,
    )) as {
      count: number;
      venues: Array<{ slug: string; rating: number }>;
    };
    assert.equal(r.count, 1);
    assert.equal(r.venues[0].slug, "sushi-bar");
    assert.equal(r.venues[0].rating, 9.1);
    for (const call of calls) assert.equal(call.auth, null);
  });

  it("never lets a redirect carry the bearer to another host", async () => {
    const { ctx } = await context();
    const calls = mock([
      ["/v1/user/me", { user: { _id: { $oid: "u1" }, name: "O" } }],
      ["/v2/delivery/info", { results: [] }],
    ]);
    await action("account.get").execute({}, ctx);
    assert.ok(calls.length > 0);
    for (const call of calls) assert.equal(call.redirect, "error");
  });

  it("keeps tokens and provider bodies out of error messages", async () => {
    const { ctx } = await context();
    mock([
      [
        "/v1/user/me",
        new Response(JSON.stringify({ access_token: "leaked", msg: "boom" }), {
          status: 500,
        }),
      ],
    ]);
    await assert.rejects(
      () => action("account.get").execute({}, ctx) as Promise<unknown>,
      (e: Error) => {
        assert.match(e.message, /HTTP 500/);
        assert.doesNotMatch(e.message, /leaked/);
        assert.doesNotMatch(e.message, /boom/);
        // The login flow can still read the body, but it is a private field, so
        // it cannot ride out through a serialized error either.
        assert.doesNotMatch(JSON.stringify(e), /leaked|boom/);
        return true;
      },
    );
  });

  it("coalesces concurrent renewals onto one grant and stores the rotated token", async () => {
    const { ctx, handle } = await context({
      accessToken: "stale",
      accessTokenExpiresAt: 1,
    });
    let grants = 0;
    mock([
      [
        "/v1/wauth2/access_token",
        () => {
          grants++;
          return {
            access_token: "fresh",
            refresh_token: "refresh-2",
            expires_in: 3600,
          };
        },
      ],
      ["/v1/user/me", { user: { _id: { $oid: "u1" } } }],
      ["/v2/delivery/info", { results: [] }],
    ]);
    await Promise.all([
      action("account.get").execute({}, ctx),
      action("address.list").execute({}, ctx),
    ]);
    assert.equal(grants, 1, "parallel actions must share one refresh");
    assert.equal((await handle.read()).config.refreshToken, "refresh-2");
  });

  it("refuses path-climbing order ids", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock([["purchase_tracking", { order_details: {} }]]);
    for (const id of ["..", "../../v1/user/me", "a/b", "  ", "?x=1"]) {
      await assert.rejects(
        () =>
          action("order.status").execute(
            { order_id: id },
            ctx,
          ) as Promise<unknown>,
        /invalid order_id/,
      );
    }
    assert.equal(calls.length, 0);
  });

  it("answers account.status from local state, with no network at all", async () => {
    const { ctx } = await context({
      paymentMethodId: undefined,
      allowOrdering: true,
    });
    const calls = mock([]);
    const r = (await action("account.status").execute({}, ctx)) as {
      connected: boolean;
      orderingEnabled: boolean;
      missing: string[];
    };
    assert.equal(calls.length, 0);
    assert.equal(r.connected, true);
    assert.equal(r.orderingEnabled, true);
    assert.deepEqual(r.missing, ["paymentMethodId (saved card)"]);
  });

  it("prices every line and option, and previews without ordering", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(orderRoutes());
    const preview = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART },
      ctx,
    )) as {
      requiresConfirmation: boolean;
      quote: string;
      summary: { payable_amount: number; items: Array<{ amount: number }> };
    };
    assert.equal(preview.requiresConfirmation, true);
    assert.match(preview.quote, /^q_[0-9a-f]{16}$/);
    // 5200 base + 300 for the "Hot" option, priced from the venue's own menu.
    assert.equal(preview.summary.items[0].amount, 5500);
    assert.equal(preview.summary.payable_amount, 6100);
    assert.equal(purchased(calls).length, 0, "a preview must never purchase");
  });

  it("orders only the total that was actually approved", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(orderRoutes(6100));
    const { quote } = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART },
      ctx,
    )) as { quote: string };

    const ordering = mock(orderRoutes(6100));
    const placed = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART, confirm: true, quote },
      ctx,
    )) as { ordered: boolean; status: string; order_id: string };
    assert.equal(placed.ordered, true);
    assert.equal(placed.status, "placed");
    assert.equal(placed.order_id, "order-9");
    assert.equal(purchased(ordering).length, 1);

    // The total moved between preview and confirmation: refuse, report the new one.
    const surged = mock(orderRoutes(8400));
    const refused = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART, confirm: true, quote },
      ctx,
    )) as {
      ordered: boolean;
      reason: string;
      summary: { payable_amount: number };
    };
    assert.equal(refused.ordered, false);
    assert.equal(refused.reason, "price_changed");
    assert.equal(refused.summary.payable_amount, 8400);
    assert.equal(purchased(surged).length, 0, "a moved total must not order");
  });

  it("refuses a confirmation that carries no quote", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(orderRoutes());
    const r = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART, confirm: true },
      ctx,
    )) as { ordered: boolean; reason: string };
    assert.equal(r.ordered, false);
    assert.equal(r.reason, "quote_required");
    assert.equal(purchased(calls).length, 0);
  });

  it("never reports an order as placed without an order id", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(orderRoutes());
    const { quote } = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART },
      ctx,
    )) as { quote: string };
    mock(orderRoutes(6100, { results: [{}] }));
    const r = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART, confirm: true, quote },
      ctx,
    )) as { ordered: boolean; status: string; note: string };
    assert.equal(r.ordered, false);
    assert.equal(r.status, "unconfirmed");
    assert.match(r.note, /no order id/);
  });

  it("gates both money actions behind allowOrdering", async () => {
    const { ctx } = await context({ allowOrdering: false });
    const priced = mock(orderRoutes());
    const preview = (await action("order.create").execute(
      { slug: "sushi-bar", items: CART },
      ctx,
    )) as { quote: string; note: string };
    assert.match(preview.note, /disabled/);
    assert.equal(purchased(priced).length, 0);

    const confirming = mock(orderRoutes());
    await assert.rejects(
      () =>
        action("order.create").execute(
          {
            slug: "sushi-bar",
            items: CART,
            confirm: true,
            quote: preview.quote,
          },
          ctx,
        ) as Promise<unknown>,
      /ordering is disabled/,
    );
    assert.equal(confirming.length, 0, "a doomed confirmation must not price");

    const cancelling = mock([["cancel", { ok: true }]]);
    await assert.rejects(
      () =>
        action("order.cancel").execute(
          { order_id: "order-9" },
          ctx,
        ) as Promise<unknown>,
      /ordering is disabled/,
    );
    assert.equal(cancelling.length, 0);
  });

  it("rejects a cart item the venue does not carry", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(orderRoutes());
    await assert.rejects(
      () =>
        action("order.create").execute(
          { slug: "sushi-bar", items: [{ id: "ghost" }] },
          ctx,
        ) as Promise<unknown>,
      /item ghost is not on venue/,
    );
    await assert.rejects(
      () =>
        action("order.create").execute(
          {
            slug: "sushi-bar",
            items: [
              { id: "i1", options: [{ id: "g1", values: [{ id: "nope" }] }] },
            ],
          },
          ctx,
        ) as Promise<unknown>,
      /option nope is not a choice/,
    );
  });

  it("reports a closed cancellation window as an answer, not an exception", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock([
      [
        "/cancel",
        new Response(JSON.stringify({ error_code: 4051, msg: "too late" }), {
          status: 400,
        }),
      ],
    ]);
    const r = (await action("order.cancel").execute(
      { order_id: "order-9" },
      ctx,
    )) as {
      cancelled: boolean;
      error_code: number;
      note: string;
    };
    assert.equal(r.cancelled, false);
    assert.equal(r.error_code, 4051);
    assert.match(r.note, /already accepted/);
  });

  it("keeps a login that worked when its optional follow-ups fail", async () => {
    const { ctx, handle } = await context({
      refreshToken: undefined,
      accessToken: undefined,
      paymentMethodId: undefined,
    });
    mock([
      [
        "/v1/wauth2/access_token",
        { access_token: "a-new", refresh_token: "r-new", expires_in: 3600 },
      ],
      ["payment_methods", new Response("", { status: 500 })],
      ["payment-methods", new Response("", { status: 500 })],
      ["/v2/delivery/info", { results: [] }],
    ]);
    const r = (await action("account.redeemLink").execute(
      { link: "https://wolt.com/login?token=abc123" },
      ctx,
    )) as { connected: boolean; ready_to_order: boolean; warnings: string[] };
    assert.equal(r.connected, true);
    assert.equal(r.ready_to_order, false);
    assert.equal((await handle.read()).config.refreshToken, "r-new");
    assert.ok(
      r.warnings.some((w) => /payment-method discovery failed/.test(w)),
    );
    assert.ok(r.warnings.some((w) => /no saved delivery address/.test(w)));
  });

  it("finds the token however deeply the email wrapped it", async () => {
    const { ctx } = await context({ refreshToken: undefined });
    const calls = mock([
      [
        "/v1/wauth2/access_token",
        { access_token: "a", refresh_token: "r", expires_in: 60 },
      ],
      [
        "payment_methods",
        { results: { cards: [{ id: "card-9", valid_for_payments: true }] } },
      ],
      ["/v2/delivery/info", { results: [{ id: "addr-1", location: {} }] }],
    ]);
    const token = "eyJhbGciOiJIUzI1NiJ9.abc-_123";
    for (const link of [
      token,
      `https://wolt.com/login?token=${token}`,
      `https://wolt.com/r?next=${encodeURIComponent(`/login?token=${token}`)}`,
    ]) {
      calls.length = 0;
      await action("account.redeemLink").execute({ link }, ctx);
      const sent = calls.find((c) => c.url.includes("access_token"));
      assert.equal(
        new URLSearchParams(String(sent?.body)).get("token"),
        token,
        `failed for ${link}`,
      );
    }
  });

  it("does not throw a URIError out of a login on a malformed link", async () => {
    const { ctx } = await context({ refreshToken: undefined });
    const calls = mock([
      [
        "/v1/wauth2/access_token",
        { access_token: "a", refresh_token: "r", expires_in: 60 },
      ],
      ["payment_methods", { results: { cards: [] } }],
      ["/v2/delivery/info", { results: [] }],
    ]);
    // %zz is not a valid escape; decoding it eagerly would abort the login.
    await action("account.redeemLink").execute(
      { link: "https://wolt.com/login?token=abc%zz" },
      ctx,
    );
    assert.ok(calls.some((c) => c.url.includes("access_token")));
    await assert.rejects(
      () =>
        action("account.redeemLink").execute(
          { link: "https://wolt.com/login?nothing=here" },
          ctx,
        ) as Promise<unknown>,
      /no `token` found/,
    );
  });

  it("reports an expired magic link as something to re-request", async () => {
    const { ctx } = await context({ refreshToken: undefined });
    mock([
      [
        "/v1/wauth2/access_token",
        new Response(JSON.stringify({ error_code: 126 }), { status: 400 }),
      ],
    ]);
    await assert.rejects(
      () =>
        action("account.redeemLink").execute(
          { link: "https://wolt.com/login?token=stale" },
          ctx,
        ) as Promise<unknown>,
      /expired or already used/,
    );
  });

  it("refuses to act on an authed action without a stored login", async () => {
    const { ctx } = await context({
      refreshToken: undefined,
      accessTokenExpiresAt: 1,
    });
    const calls = mock([["", { ok: true }]]);
    await assert.rejects(
      () => action("account.get").execute({}, ctx) as Promise<unknown>,
      /not connected/,
    );
    assert.equal(calls.length, 0);
  });
});
