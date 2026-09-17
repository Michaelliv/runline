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
 * A real connection handle, so token rotation goes through the same
 * update-ownership path the engine gives a plugin at runtime.
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

/** Route by path fragment; every unmatched call fails loudly rather than silently. */
function mock(routes: Array<[string, unknown | (() => unknown)]>) {
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
      if (url.includes(fragment)) {
        const value = typeof payload === "function" ? payload() : payload;
        if (value instanceof Response) return value;
        return new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ unrouted: url }), { status: 404 });
  }) as typeof fetch;
  return calls;
}

/** The provider calls a ride costs money; the happy path needs the whole chain. */
function ridePlanRoutes(price = "₪45.00") {
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
    ["global-ride-request/api/v1/create", { rc: 0, order: { id: "order-9" } }],
  ] as Array<[string, unknown | (() => unknown)]>;
}

describe("gett plugin surface", () => {
  it("registers nine actions with typed schemas and correct access", () => {
    assert.equal(plugin.name, "gett");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "book_ride",
      "cancel_ride",
      "connect",
      "find_place",
      "nearby_drivers",
      "price",
      "refresh",
      "ride_status",
      "whoami",
    ]);
    const writes = plugin.actions
      .filter((a) => a.access === "write")
      .map((a) => a.name)
      .sort();
    assert.deepEqual(writes, [
      "book_ride",
      "cancel_ride",
      "connect",
      "refresh",
    ]);
    // Typed schemas are what make the engine validate before execute runs — on a
    // plugin that spends money, an unvalidated input is the whole risk.
    for (const a of plugin.actions) {
      assert.ok(
        isTypedInputSchema(a.inputSchema),
        `${a.name} must use a TypeBox schema`,
      );
    }
    assert.ok(isTypedInputSchema(plugin.connectionConfigSchema));
  });

  it("rejects malformed and unknown input before any request", () => {
    globalThis.fetch = (async () => {
      throw new Error("must not reach the network");
    }) as typeof fetch;
    const invalid: Array<[string, unknown]> = [
      ["book_ride", { from: "a" }],
      ["book_ride", { from: "a", to: "b", surprise: true }],
      ["book_ride", { from: "a", to: "b", confirm: "yes" }],
      ["book_ride", { from: "a", to: "b", lat: 999 }],
      ["find_place", { query: "" }],
      ["ride_status", {}],
      ["cancel_ride", { order_id: "o", reason: 1.5 }],
      ["connect", { phone: "0500000000", extra: 1 }],
      ["refresh", { anything: true }],
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
      const r = (await action("connect").execute({ phone: entered }, ctx)) as {
        phone: string;
      };
      assert.equal(r.phone, expected);
      assert.ok(calls[0].url.includes(`/phone/${expected}/`), calls[0].url);
    }
  });

  it("refuses path-climbing ids instead of encoding and hoping", async () => {
    const { ctx } = await context();
    const calls = mock([["orders", { id: "x" }]]);
    for (const id of [
      "..",
      "../../auth/token",
      "a/b",
      "",
      "  ",
      "?x=1",
      "#f",
    ]) {
      await assert.rejects(
        () =>
          action("ride_status").execute(
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
          {
            status: 500,
          },
        ),
      ],
    ]);
    await assert.rejects(
      () => action("whoami").execute({}, ctx) as Promise<unknown>,
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
    await action("whoami").execute({}, ctx);
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
      action("whoami").execute({}, ctx),
      action("nearby_drivers").execute({}, ctx),
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
      () => action("whoami").execute({}, ctx) as Promise<unknown>,
      /session expired .* re-run the owner login/,
    );
  });

  it("previews a ride with a quote and books nothing", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(ridePlanRoutes());
    const preview = (await action("book_ride").execute(
      { from: "a", to: "b" },
      ctx,
    )) as {
      requiresConfirmation: boolean;
      quote: string;
      summary: { price: string };
    };
    assert.equal(preview.requiresConfirmation, true);
    assert.match(preview.quote, /^q_[0-9a-f]{16}$/);
    assert.equal(preview.summary.price, "₪45.00");
    assert.equal(
      calls.filter((c) => c.url.includes("ride-request")).length,
      0,
      "a preview must never reach the create endpoint",
    );
  });

  it("books only the fare that was actually approved", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock(ridePlanRoutes("₪45.00"));
    const preview = (await action("book_ride").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string };

    // Same fare, matching quote: books.
    const calls = mock(ridePlanRoutes("₪45.00"));
    const booked = (await action("book_ride").execute(
      { from: "a", to: "b", confirm: true, quote: preview.quote },
      ctx,
    )) as { status: string; order_id: string };
    assert.equal(booked.status, "booked");
    assert.equal(booked.order_id, "order-9");
    assert.equal(calls.filter((c) => c.url.includes("ride-request")).length, 1);

    // Surge between preview and confirmation: refuses, and hands back the new price.
    const surged = mock(ridePlanRoutes("₪98.00"));
    const refused = (await action("book_ride").execute(
      { from: "a", to: "b", confirm: true, quote: preview.quote },
      ctx,
    )) as { booked: boolean; reason: string; summary: { price: string } };
    assert.equal(refused.booked, false);
    assert.equal(refused.reason, "price_changed");
    assert.equal(refused.summary.price, "₪98.00");
    assert.equal(
      surged.filter((c) => c.url.includes("ride-request")).length,
      0,
      "a moved fare must not book",
    );
  });

  it("refuses a confirmation that carries no quote at all", async () => {
    const { ctx } = await context({ allowOrdering: true });
    const calls = mock(ridePlanRoutes());
    const r = (await action("book_ride").execute(
      { from: "a", to: "b", confirm: true },
      ctx,
    )) as { booked: boolean; reason: string };
    assert.equal(r.booked, false);
    assert.equal(r.reason, "quote_required");
    assert.equal(calls.filter((c) => c.url.includes("ride-request")).length, 0);
  });

  it("gates both money actions behind allowOrdering", async () => {
    const { ctx } = await context({ allowOrdering: false });
    const calls = mock([...ridePlanRoutes(), ["cancel", { rc: 0 }]]);
    const preview = (await action("book_ride").execute(
      { from: "a", to: "b" },
      ctx,
    )) as { quote: string; note: string };
    // The preview must not tell the caller to do something that will be refused.
    assert.match(preview.note, /disabled/);
    await assert.rejects(
      () =>
        action("book_ride").execute(
          { from: "a", to: "b", confirm: true, quote: preview.quote },
          ctx,
        ) as Promise<unknown>,
      /ordering is disabled/,
    );
    await assert.rejects(
      () =>
        action("cancel_ride").execute(
          { order_id: "order-9" },
          ctx,
        ) as Promise<unknown>,
      /disabled for this connection/,
    );
    assert.equal(calls.filter((c) => c.url.includes("ride-request")).length, 0);
    assert.equal(calls.filter((c) => c.url.includes("/cancel")).length, 0);
  });

  it("reports whether an optional cancellation reason landed", async () => {
    const { ctx } = await context({ allowOrdering: true });
    mock([
      ["order_cancellation_reason", new Response("", { status: 500 })],
      ["cancel", { rc: 0 }],
    ]);
    const r = (await action("cancel_ride").execute(
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
      () => action("nearby_drivers").execute({}, ctx) as Promise<unknown>,
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
      () => action("whoami").execute({}, ctx) as Promise<unknown>,
      /not connected/,
    );
    assert.equal(calls.length, 0);
  });
});
