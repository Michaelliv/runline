import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { search } from "./places.js";
import { book, optionsOf, plan, previewOf, quoteFor } from "./rides.js";
import {
  createSession,
  identityOf,
  requestCode,
  status,
  verifyCard,
  verifyCode,
} from "./session.js";
import {
  accessToken,
  arr,
  authed,
  cfgOf,
  DEF_LAT,
  DEF_LON,
  num,
  numOrNull,
  obj,
  pick,
  seg,
} from "./shared.js";

/**
 * gett — Gett (taxi, Israel) consumer connector.
 *
 * Reaches the owner's PRIVATE Gett account through the mobile app surface
 * (`b2cgateway.gett.com`). The official Business API is gated on a per-company
 * `order` entitlement that is not self-serve, so this rides the JSON REST surface
 * the phone app uses. Unofficial by nature: it can break or be blocked without notice.
 *
 * Auth: phone + SMS OTP + a card-digits second factor (a trusted device skips the
 * third step). A long-lived refresh token then mints short access tokens; both live
 * in the connection and rotate through `ctx.updateConnection`, which coalesces
 * concurrent renewals. No keepalive schedule is needed — the refresh grant does not
 * require a live access token, so a stored session survives unattended.
 *
 * Money: `ride.book` summons a real car and charges the account's saved card, so
 * consent is bound to a fare rather than to an intent. A call without `confirm`
 * returns a priced preview and a `quote` fingerprinting the route, class, and fare;
 * booking needs `allowOrdering` on the connection, `confirm: true`, and that same
 * quote still pricing identically. A fare that moved refuses and reports the new one.
 */

const STRICT = { additionalProperties: false } as const;

const latSchema = t.Number({
  minimum: -90,
  maximum: 90,
  description:
    "Bias latitude for place search. Defaults to the connection's home location.",
});
const lonSchema = t.Number({
  minimum: -180,
  maximum: 180,
  description: "Bias longitude for place search.",
});
const placeSchema = (description: string) =>
  t.String({ minLength: 1, maxLength: 300, description });
const orderIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  description: "Order id returned by ride.book.",
});

/** Where a request's search bias comes from when the caller gives none. */
function bias(input: Record<string, unknown>, ctx: ActionContext) {
  const cfg = cfgOf(ctx);
  return {
    lat: num(input.lat ?? cfg.defaultLat, DEF_LAT),
    lon: num(input.lon ?? cfg.defaultLon, DEF_LON),
  };
}

export default function gett(rl: RunlinePluginAPI) {
  rl.setName("gett");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      phone: t.Optional(
        t.String({
          env: "GETT_PHONE",
          description:
            "Account phone. International or local Israeli digits both work (972500000000, 0500000000, 050-000-0000); all normalize to 972…",
        }),
      ),
      refreshToken: t.Optional(
        t.String({
          env: "GETT_REFRESH_TOKEN",
          description:
            "Long-lived refresh JWT from an owner login; mints access tokens. Written by account.verifyCode/verifyCard. Store only in secrets.",
        }),
      ),
      creditCardId: t.Optional(
        t.String({
          env: "GETT_CREDIT_CARD_ID",
          description:
            "Saved card charged for rides. Discovered automatically during login.",
        }),
      ),
      deviceId: t.Optional(
        t.String({
          env: "GETT_DEVICE_ID",
          description:
            "x-device-id for the device session. Generated if absent.",
        }),
      ),
      clientDeviceUniqueId: t.Optional(
        t.String({
          env: "GETT_CLIENT_DEVICE_UNIQUE_ID",
          description: "x-client-device-unique-id. Generated if absent.",
        }),
      ),
      defaultLat: t.Optional(
        t.String({
          env: "GETT_DEFAULT_LAT",
          description:
            "Home latitude used when a request carries no bias (e.g. 32.0779).",
        }),
      ),
      defaultLon: t.Optional(
        t.String({
          env: "GETT_DEFAULT_LON",
          description:
            "Home longitude used when a request carries no bias (e.g. 34.7743).",
        }),
      ),
      allowOrdering: t.Optional(
        t.Boolean({
          default: false,
          description:
            "Master switch for ride.book and ride.cancel. Off leaves the connection read-only. Even on, ride.book still needs confirm:true and a matching quote.",
        }),
      ),
    }),
  );

  /* ---------------------------------------------------------------- */
  /* account — the owner login and the session it carries             */
  /* ---------------------------------------------------------------- */

  rl.registerAction("account.requestCode", {
    access: "write",
    description:
      "Step 1 of the owner login: ask Gett to text a one-time code to the account's phone. Returns sent:true with the code length, or sent:false when Gett refuses (rate limit or block) — it answers 200 either way, so trust this flag rather than the absence of an error. Follow with account.verifyCode.",
    inputSchema: t.Object(
      {
        phone: t.Optional(
          t.String({
            minLength: 6,
            maxLength: 32,
            description:
              "Account phone. Israeli local or international digits both work. Omit to reuse the connection's stored phone.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { phone } = (input ?? {}) as { phone?: string };
      return requestCode(ctx, phone);
    },
  });

  rl.registerAction("account.verifyCode", {
    access: "write",
    description:
      "Step 2 of the owner login: exchange the texted code for tokens. Returns connected:true when the device is trusted, or mfa_required:true when Gett wants the card second factor — then call account.verifyCard.",
    inputSchema: t.Object(
      {
        code: t.String({
          minLength: 3,
          maxLength: 12,
          description: "The one-time code from the SMS.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { code } = input as { code: string };
      return verifyCode(ctx, code);
    },
  });

  rl.registerAction("account.verifyCard", {
    access: "write",
    description:
      "Step 3 of the owner login, when account.verifyCode reported mfa_required: prove the account with the last digits of its saved card. On success the session is connected and every other action works without a further login.",
    inputSchema: t.Object(
      {
        card: t.String({
          minLength: 2,
          maxLength: 8,
          description: "Last 4 digits of the saved card.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { card } = input as { card: string };
      return verifyCard(ctx, card);
    },
  });

  rl.registerAction("account.status", {
    access: "read",
    description:
      "What the stored session has and still needs, read locally with no network call — so it answers even when the session is broken. Reports whether ordering is enabled and whether a login is half-finished.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return status(ctx);
    },
  });

  rl.registerAction("account.refresh", {
    access: "write",
    description:
      "Force a fresh access token from the stored refresh token. Rarely needed: every action renews on demand, and the refresh token is long-lived (~90 days), so no keepalive schedule is required. Useful to prove a stored session is still good.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      await accessToken(ctx, true);
      const cfg = cfgOf(ctx);
      return {
        refreshed: true,
        access_expires_at: cfg.accessTokenExpiresAt
          ? new Date(cfg.accessTokenExpiresAt).toISOString()
          : null,
      };
    },
  });

  rl.registerAction("account.get", {
    access: "read",
    description:
      "The live account behind the session: rider identity plus any orders in flight. Hits Gett, so it also confirms the credentials still work — account.status answers the same shape from local state alone.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      const session = await createSession(ctx, DEF_LAT, DEF_LON);
      return {
        ...identityOf(ctx, session),
        active_orders: arr(session.active_orders).map((o) => ({
          id: pick(obj(o).id, obj(o).order_id),
          status: pick(obj(o).status),
        })),
        active_requests: arr(session.active_requests).length,
      };
    },
  });

  /* ---------------------------------------------------------------- */
  /* place / driver — read-only lookups                               */
  /* ---------------------------------------------------------------- */

  rl.registerAction("place.search", {
    access: "read",
    description:
      "Find a pickup or drop-off by name or address ('Dizengoff Square', 'Ben Gurion Airport'). Hebrew works. Returns ranked candidates with coordinates; pass a name straight to ride.price or ride.book instead if you do not need to choose.",
    inputSchema: t.Object(
      {
        query: placeSchema("Place name or address to search for."),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { lat, lon } = bias(p, ctx);
      return search(ctx, String(p.query), lat, lon);
    },
  });

  rl.registerAction("driver.listNearby", {
    access: "read",
    description:
      "Live positions of Gett drivers around a point — an availability check before quoting, or a map. Read-only.",
    inputSchema: t.Object(
      { lat: t.Optional(latSchema), lon: t.Optional(lonSchema) },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const { lat, lon } = bias(p, ctx);
      const query = new URLSearchParams({ lat: String(lat), lng: String(lon) });
      const r = await authed(ctx, `/gl/api/v2/drivers/locations?${query}`);
      return arr(r.drivers).map((raw) => {
        const d = obj(raw);
        return {
          id: pick(d.id),
          status: pick(d.status),
          location: arr(d.last_locations)[0] ?? null,
          route_eta_ts: numOrNull(d.route_eta_ts),
        };
      });
    },
  });

  /* ---------------------------------------------------------------- */
  /* ride — pricing, booking, tracking                                */
  /* ---------------------------------------------------------------- */

  rl.registerAction("ride.price", {
    access: "read",
    description:
      "Price a ride between two places by name: every available class (Taxi, Priority, …) with its fare and pickup ETA. Books nothing and charges nothing. To actually book, use ride.book — it prices the ride itself and returns a quote to confirm against.",
    inputSchema: t.Object(
      {
        from: placeSchema("Pickup place or address."),
        to: placeSchema("Destination place or address."),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { lat, lon } = bias(p, ctx);
      const ride = await plan(ctx, String(p.from), String(p.to), lat, lon);
      return {
        from: { name: ride.from.name, address: ride.from.full_address },
        to: { name: ride.to.name, address: ride.to.full_address },
        options: optionsOf(ride),
      };
    },
  });

  rl.registerAction("ride.book", {
    access: "write",
    description:
      "Book a REAL taxi: this charges the saved card and sends an actual car to an actual person. Call it first WITHOUT confirm to get a priced preview and a `quote`. Read the fare and the pickup back to the person, get an explicit yes, then call again with confirm:true and that exact quote. If the fare moved in between, nothing is booked and the new price is returned instead, because consent was given to a price and not to a journey. Needs allowOrdering on the connection.",
    inputSchema: t.Object(
      {
        from: placeSchema("Pickup place or address."),
        to: placeSchema("Destination place or address."),
        class_uuid: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 128,
            description:
              "Ride class from ride.price. Defaults to the account's usual class.",
          }),
        ),
        note: t.Optional(
          t.String({ maxLength: 500, description: "Note to the driver." }),
        ),
        confirm: t.Optional(
          t.Boolean({
            description:
              "True only after a person heard the fare and pickup and said yes. Must be sent together with the quote from the preview call.",
          }),
        ),
        quote: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 64,
            description:
              "The quote from the preview call. Binds this booking to the exact fare that was approved.",
          }),
        ),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const { lat, lon } = bias(p, ctx);
      const ride = await plan(
        ctx,
        String(p.from),
        String(p.to),
        lat,
        lon,
        p.class_uuid ? String(p.class_uuid) : undefined,
      );
      const quote = quoteFor(ride);
      const summary = previewOf(ride);

      if (p.confirm !== true) {
        return {
          requiresConfirmation: true,
          action: "ride.book",
          quote,
          summary,
          note: cfg.allowOrdering
            ? "Books a REAL taxi and charges the saved card. Read the fare and pickup back to the person, then re-run with confirm:true and this quote."
            : "Ordering is disabled for this connection (allowOrdering is false), so this preview cannot be booked. Enable allowOrdering first.",
        };
      }
      if (!cfg.allowOrdering)
        throw new Error(
          "gett ride.book: ordering is disabled for this connection (set allowOrdering:true). Refusing to book.",
        );
      if (p.quote !== quote) {
        return {
          booked: false,
          reason: p.quote ? "price_changed" : "quote_required",
          quote,
          summary,
          note: p.quote
            ? "The fare or class changed since the quote that was approved, so nothing was booked. Read the new fare back and confirm again with the new quote."
            : "confirm:true must carry the quote from the preview call, so a person can only approve a fare they were shown. Nothing was booked.",
        };
      }
      const result = await book(ctx, ride, p.note ? String(p.note) : undefined);
      return {
        ok: result.ok,
        status: "booked",
        order_id: result.order_id,
        summary,
        track_with: `ride.status({ order_id: "${result.order_id}" })`,
      };
    },
  });

  rl.registerAction("ride.status", {
    access: "read",
    description:
      "Track a booked ride — 'where is my taxi?'. Status, ETA in seconds, distance, whether it is still cancellable for free, and the driver once assigned.",
    inputSchema: t.Object({ order_id: orderIdSchema }, STRICT),
    async execute(input, ctx) {
      const { order_id } = input as { order_id: string };
      const cfg = cfgOf(ctx);
      const r = await authed(
        ctx,
        `/gl/server/3_3/phone/${seg(cfg.phone, "phone")}/orders/${seg(order_id, "order_id")}`,
      );
      return {
        order_id: pick(r.id) ?? order_id,
        status: pick(r.status),
        eta_seconds: numOrNull(r.eta),
        distance_m: numOrNull(r.distance),
        cancellable: r.cancellable_by_client ?? null,
        driver_assigned_at: pick(r.driver_assigned_at),
        payment_type: pick(r.payment_type),
        driver: r.driver ?? r.driver_details ?? null,
      };
    },
  });

  rl.registerAction("ride.cancel", {
    access: "write",
    description:
      "Cancel a booked ride. Free inside the cancellation window — check ride.status.cancellable first, because a late cancel can incur a fee. Needs allowOrdering on the connection.",
    inputSchema: t.Object(
      {
        order_id: orderIdSchema,
        reason: t.Optional(
          t.Integer({
            minimum: 0,
            description:
              "Gett cancellation reason id, recorded before cancelling.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { order_id, reason } = input as {
        order_id: string;
        reason?: number;
      };
      const cfg = cfgOf(ctx);
      if (!cfg.allowOrdering)
        throw new Error(
          "gett ride.cancel: ordering is disabled for this connection (set allowOrdering:true).",
        );
      const phone = seg(cfg.phone, "phone");
      const order = seg(order_id, "order_id");
      // The reason is optional metadata; a rejection there must not block the
      // cancel, but the caller is told whether it landed rather than left to guess.
      let reasonRecorded: boolean | null = null;
      if (reason != null) {
        reasonRecorded = await authed(
          ctx,
          `/gl/server/2_9/phone/${phone}/orders/${order}/order_cancellation_reason`,
          { method: "POST", body: { cancellation_reason_id: reason } },
        ).then(
          () => true,
          () => false,
        );
      }
      const r = await authed(
        ctx,
        `/gl/server/3_0/phone/${phone}/orders/${order}/cancel`,
        { method: "POST", body: {} },
      );
      return {
        cancelled: r.rc === 0,
        order_id,
        reason_recorded: reasonRecorded,
      };
    },
  });
}
