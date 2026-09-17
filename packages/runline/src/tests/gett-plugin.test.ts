import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import gett from "../../../runline-plugins/gett/src/index.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { createPluginAPI } from "../plugin/api.js";
import { isTypedInputSchema } from "../plugin/schema.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build(): PluginDef {
  const { api, resolve } = createPluginAPI("gett");
  gett(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected gett.${name} to be registered`);
  return found;
}

const CONNECTED = {
  phone: "972500000000",
  refreshToken: "refresh-1",
  accessToken: "access-1",
  accessTokenExpiresAt: Date.now() + 3_600_000,
  creditCardId: "card-1",
  deviceId: "device-1",
  clientDeviceUniqueId: "cdui-1",
};

/**
 * A real connection handle, so token rotation runs through the same update
 * ownership the engine gives a plugin at runtime.
 */
async function context(config: Record<string, unknown> = {}) {
  const store = new MemoryConnectionProvider([
    { name: "account", plugin: "gett", config: { ...CONNECTED, ...config } },
  ]);
  const handle = await store.resolve({ plugin: "gett" });
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
  body: Record<string, unknown>;
}

type Route = [string, unknown | (() => unknown)];

/** Route by path fragment; anything unrouted 404s loudly rather than passing. */
function mock(routes: Route[]) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      body: init?.body ? JSON.parse(String(init.body)) : {},
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

/** Calls that reached the one endpoint which actually orders a car. */
function created(list: Call[]): Call[] {
  return list.filter((c) => new URL(c.url).pathname.endsWith("/create"));
}

/**
 * The full chain a priced ride walks: session, both lookups, pricing, and the
 * endpoint that orders the car. Routes match first-wins, so the create response
 * is a parameter rather than something a caller can append and expect to win.
 */
function ridePlanRoutes(
  price = "45.00",
  createResponse: unknown = { rc: 0, order: { id: "order-9" } },
): Route[] {
  return [
    [
      "create_session",
      { user_profile: { global_user_id: 7, first_name: "O" } },
    ],
    [
      "locations/autocomplete",
      {
        locations: [
          {
            id: "1",
            provider_place_id: "p1",
            provider: "google",
            location: { main_text: "Origin", lat: 32, lng: 34 },
          },
        ],
      },
    ],
    [
      "locations/retrieve",
      {
        locations: [
          {
            provider_place_id: "p1",
            provider: "google",
            location: { main_text: "Origin", lat: 32, lng: 34 },
          },
        ],
      },
    ],
    [
      "preorder/aggregated",
      () => ({
        routes: [{ uuid: "route-1" }],
        private_default_class_uuid: "class-1",
        classes_with_prices: [
          {
            class: { uuid: "class-1", name: "Taxi", display_eta: 4 },
            price: {
              pricing_options: [
                {
                  estimation_id: "est-1",
                  user_price: price,
                  currency_iso: "ILS",
                },
              ],
            },
          },
        ],
      }),
    ],
    ["global-ride-request/api/v1/create", createResponse],
  ];
}

describe("gett plugin surface", () => {
  it("registers resource.verb actions with typed schemas and correct access", () => {
    assert.equal(plugin.name, "gett");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "account.get",
      "account.refresh",
      "account.requestCode",
      "account.status",
      "account.verifyCard",
      "account.verifyCode",
      "driver.listNearby",
      "place.search",
      "ride.book",
      "ride.cancel",
      "ride.price",
      "ride.status",
    ]);
    assert.deepEqual(
      plugin.actions
        .filter((a) => a.access === "write")
        .map((a) => a.name)
        .sort(),
      [
        "account.refresh",
        "account.requestCode",
        "account.verifyCard",
        "account.verifyCode",
        "ride.book",
        "ride.cancel",
      ],
    );
    // Typed schemas are what make the engine validate before execute runs. On the
    // one plugin in the catalog that spends money, that is not optional.
    for (const a of plugin.actions) {
      assert.ok(
        isTypedInputSchema(a.inputSchema),
        `${a.name} must use a TypeBox schema`,
      );
    }
    assert.ok(isTypedInputSchema(plugin.connectionConfigSchema));
  });

  it("requires each login step's own input, which a single dispatch action could not", () => {
    // Every field optional is the price of one connect() that switches on shape;
    // one action per step lets the schema demand what the step actually needs.
    assert.equal(
      Check(action("account.verifyCode").inputSchema as TSchema, {}),
      false,
    );
    assert.equal(
      Check(action("account.verifyCard").inputSchema as TSchema, {}),
      false,
    );
    assert.equal(
      Check(action("account.requestCode").inputSchema as TSchema, {}),
      true,
      "requestCode may reuse a stored phone",
    );
  });

  it("rejects malformed and unknown input before any request", () => {
    globalThis.fetch = (async () => {
      throw new Error("must not reach the network");
    }) as typeof fetch;
    const invalid: Array<[string, unknown]> = [
      ["ride.book", { from: "a" }],
      ["ride.book", { from: "a", to: "b", surprise: true }],
      ["ride.book", { from: "a", to: "b", confirm: "yes" }],
      ["ride.book", { from: "a", to: "b", lat: 999 }],
      ["place.search", { query: "" }],
      ["ride.status", {}],
      ["ride.cancel", { order_id: "o", reason: 1.5 }],
      ["account.verifyCode", { code: "" }],
      ["account.requestCode", { phone: "0500000000", extra: 1 }],
      ["account.refresh", { anything: true }],
    ];
    for (const [name, input] of invalid) {
      assert.equal(
        Check(action(name).inputSchema as TSchema, input),
        false,
        `${name} should reject ${JSON.stringify(input)}`,
      );
    }
  });

  it("normalizes local Israeli phone numbers into the international path", async () => {
    const { ctx } = await context({
      phone: undefined,
      refreshToken: undefined,
    });
    const calls = mock([
      ["auth/otp/challenge", { rc: 0, confirmation_code_length: 4 }],
    ]);
    for (const [entered, expected] of [
      ["050-000-0000", "972500000000"],
      ["0500000000", "972500000000"],
      ["972500000000", "972500000000"],
      ["00972500000000", "972500000000"],
      ["500000000", "972500000000"],
    ] as const) {
      calls.length = 0;
      const r = (await action("account.requestCode").execute(
        { phone: entered },
        ctx,
      )) as { sent: boolean; phone: string };
      assert.equal(r.sent, true);
      assert.equal(r.phone, expected);
      assert.ok(calls[0].url.includes(`/phone/${expected}/`), calls[0].url);
    }
  });

  it("reports a refused SMS instead of a code that will never arrive", async () => {
    const { ctx } = await context({ refreshToken: undefined });
    mock([["auth/otp/challenge", { status: "blocked", blocked_until: 30 }]]);
    const r = (await action("account.requestCode").execute({}, ctx)) as {
      sent: boolean;
      blocked: boolean;
      retry_after_minutes: number;
    };
    assert.equal(r.sent, false);
    assert.equal(r.blocked, true);
    assert.equal(r.retry_after_minutes, 30);
  });

  it("refuses path-climbing ids instead of encoding and hoping", async () => {
    const { ctx } = await context();
    const calls = mock([["orders", { id: "x" }]]);
    for (const id of ["..", "../../auth/token", "a/b", "  ", "?x=1", "#f"]) {
      await assert.rejects(
        () =>
          action("ride.status").execute(
            { order_id: id },
            ctx,
          ) as Promise<unknown>,
        /invalid order_id/,
      );
    }
    assert.equal(calls.length, 0);
  });

  it("never puts the account phone or a provider body into an error", async () => {
    const { ctx } = await context();
    mock([
      [
        "create_session",
        new Response(
          JSON.stringify({ token: "leaked-secret", message: "boom" }),
          { status: 500 },
        ),
      ],
    ]);
    await assert.rejects(
      () => action("account.get").execute({}, ctx) as Promise<unknown>,
      (e: Error) => {
        assert.match(e.message, /HTTP 500/);
        assert.match(e.message, /\{phone\}/);
        assert.doesNotMatch(e.message, /972500000000/);
        assert.doesNotMatch(e.message, /leaked-secret/);
        assert.doesNotMatch(e.message, /boom/);
        return true;
      },
    );
  });

  it("never lets a redirect carry the bearer to another host", async () => {
    const { ctx } = await context();
    const calls = mock([["create_session", { user_profile: {} }]]);
    await action("account.get").execute({}, ctx);
    assert.ok(calls.length > 0);
    for (const call of calls) assert.equal(call.redirect, "error");
  });

  it("coalesces concurrent renewals onto one grant and rotates the refresh token", async () => {
    const { ctx, handle } = await context({
      accessToken: "stale",
      accessTokenExpiresAt: 1,
    });
    let grants = 0;
    const calls = mock([
      [
        "auth/token",
        () => {
          grants++;
          return {
            access_token: "fresh",
            refresh_token: "refresh-2",
            expires_in: 3600,
          };
        },
      ],
      ["create_session", { user_profile: {} }],
      ["drivers/locations", { drivers: [] }],
    ]);
    await Promise.all([
      action("account.get").execute({}, ctx),
      action("driver.listNearby").execute({}, ctx),
    ]);
    assert.equal(grants, 1, "parallel actions must share one refresh");
    assert.equal((await handle.read()).config.refreshToken, "refresh-2");
    for (const call of calls.filter((c) => !c.url.includes("auth/token"))) {
      assert.equal(call.auth, "Bearer fresh");
    }
  });

  it("reports a dead refresh token as a re-login, not as a bare 400", async () => {
    const { ctx } = await context({ accessTokenExpiresAt: 1 });
    mock([["auth/token", new Response("", { status: 400 })]]);
    await assert.rejects(
      () => action("account.get").execute({}, ctx) as Promise<unknown>,
      /session expired .* account\.requestCode/,
    );
  });

  it("answers account.status from local state, with no network at all", async () => {
    const { ctx } = await context({
      creditCardId: undefined,
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
    assert.deepEqual(r.missing, ["creditCardId (auto-discovered on login)"]);
  });

  it("keeps a login that succeeded when its optional follow-ups fail", async () => {
    const { ctx, handle } = await context({
      refreshToken: undefined,
      accessToken: undefined,
      pendingTempCode: "temp-1",
    });
    let grants = 0;
    mock([
      [
        "auth/mfa/verify",
        {
          tokens: {
            refresh_token: "r-new",
            access_token: "a-new",
            expires_in: 3600,
          },
        },
      ],
      [
        "auth/token",
        () => {
          grants++;
          return new Response("", { status: 500 });
        },
      ],
      ["create_session", new Response("", { status: 503 })],
    ]);
    const r = (await action("account.verifyCard").execute(
      { card: "4242" },
      ctx,
    )) as { connected: boolean; warnings: string[] };
    assert.equal(r.connected, true);
    assert.equal((await handle.read()).config.refreshToken, "r-new");
    assert.ok(grants > 0);
    // Both optional steps failed; neither is hidden and neither lost the login.
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /IL->GL token conversion failed/);
    assert.match(r.warnings[1], /saved-card discovery failed/);
  });

  it("previews a ride with a quote and books nothing", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(ridePlanRoutes());
    const preview = (await action("ride.book").execute(
      { from: "a", to: "b" },
      ctx,
    )) as {
      requiresConfirmation: boolean;
      quote: string;
      summary: { price: string };
    };
    assert.equal(preview.requiresConfirmation, true);
    assert.match(preview.quote, /^q_[0-9a-f]{16}$/);
    assert.equal(preview.summary.price, "45.00");
    assert.equal(created(calls).length, 0, "a preview must never reach create");
  });

  it("books only the fare that was actually approved", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(ridePlanRoutes("45.00"));
    const preview = (await action("ride.book").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string };

    // Same fare, matching quote: books.
    const booking = mock(ridePlanRoutes("45.00"));
    const booked = (await action("ride.book").execute(
      { from: "a", to: "b", confirm: true, quote: preview.quote },
      ctx,
    )) as { booked: boolean; status: string; order_id: string };
    assert.equal(booked.booked, true);
    assert.equal(booked.status, "booked");
    assert.equal(booked.order_id, "order-9");
    assert.equal(created(booking).length, 1);

    // Surge between preview and confirmation: refuses, and hands back the new price.
    const surged = mock(ridePlanRoutes("98.00"));
    const refused = (await action("ride.book").execute(
      { from: "a", to: "b", confirm: true, quote: preview.quote },
      ctx,
    )) as { booked: boolean; reason: string; summary: { price: string } };
    assert.equal(refused.booked, false);
    assert.equal(refused.reason, "price_changed");
    assert.equal(refused.summary.price, "98.00");
    assert.equal(created(surged).length, 0, "a moved fare must not book");
  });

  it("never reports a ride as booked over a body that refused it", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(ridePlanRoutes());
    const { quote } = (await action("ride.book").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string };
    mock(ridePlanRoutes("45.00", { rc: 7, error: "no supply" }));
    const r = (await action("ride.book").execute(
      { from: "a", to: "b", confirm: true, quote },
      ctx,
    )) as { booked: boolean; status: string };
    assert.equal(r.booked, false);
    assert.equal(r.status, "rejected");
  });

  it("treats a 2xx with no verdict as accepted, so no one orders a second car", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(ridePlanRoutes());
    const { quote } = (await action("ride.book").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string };
    // No rc and no status: the transport already rejected every non-2xx, so the
    // order stands. Guessing the other way would summon a second taxi.
    mock(ridePlanRoutes("45.00", { order: { id: "order-9" } }));
    const r = (await action("ride.book").execute(
      { from: "a", to: "b", confirm: true, quote },
      ctx,
    )) as { booked: boolean; track_with: string };
    assert.equal(r.booked, true);
    assert.match(r.track_with, /order-9/);
  });

  it("refuses a confirmation that carries no quote at all", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(ridePlanRoutes());
    const r = (await action("ride.book").execute(
      { from: "a", to: "b", confirm: true },
      ctx,
    )) as { booked: boolean; reason: string };
    assert.equal(r.booked, false);
    assert.equal(r.reason, "quote_required");
    assert.equal(created(calls).length, 0);
  });

  it("gates both money actions behind allowOrdering", async () => {
    const { ctx } = await context({ allowOrdering: false });

    const priced = mock(ridePlanRoutes());
    const preview = (await action("ride.book").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string; note: string };
    // A preview must not instruct the caller to do something that will be refused.
    assert.match(preview.note, /disabled/);
    assert.equal(created(priced).length, 0);

    // A confirmation that ordering will refuse costs nothing: it is decided
    // before the four requests that price a ride.
    const confirming = mock(ridePlanRoutes());
    await assert.rejects(
      () =>
        action("ride.book").execute(
          { from: "a", to: "b", confirm: true, quote: preview.quote },
          ctx,
        ) as Promise<unknown>,
      /ordering is disabled/,
    );
    assert.equal(confirming.length, 0, "a doomed confirmation must not price");

    const cancelling = mock([["cancel", { rc: 0 }]]);
    await assert.rejects(
      () =>
        action("ride.cancel").execute(
          { order_id: "order-9" },
          ctx,
        ) as Promise<unknown>,
      /ordering is disabled/,
    );
    assert.equal(cancelling.length, 0, "a disabled connection cannot cancel");
  });

  it("refuses to book a class the route does not offer", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(ridePlanRoutes());
    await assert.rejects(
      () =>
        action("ride.book").execute(
          { from: "a", to: "b", class_uuid: "class-nope" },
          ctx,
        ) as Promise<unknown>,
      /class-nope is not available/,
    );
  });

  it("reports whether an optional cancellation reason landed", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock([
      ["order_cancellation_reason", new Response("", { status: 500 })],
      ["cancel", { rc: 0 }],
    ]);
    const r = (await action("ride.cancel").execute(
      { order_id: "order-9", reason: 3 },
      ctx,
    )) as { cancelled: boolean; reason_recorded: boolean | null };
    assert.equal(r.cancelled, true);
    assert.equal(r.reason_recorded, false);
  });

  it("surfaces a broken session instead of reporting an empty road", async () => {
    const { ctx } = await context();
    mock([["drivers/locations", new Response("", { status: 401 })]]);
    await assert.rejects(
      () => action("driver.listNearby").execute({}, ctx) as Promise<unknown>,
      /HTTP 401/,
    );
  });

  it("refuses to act at all without a stored login", async () => {
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
