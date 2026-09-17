import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  discoverPaymentMethod,
  listAddresses,
  loginMethods,
  redeemLink,
  requestEmailCode,
  requestSmsCode,
  status,
  submitCode,
  submitConfirmation,
  whoami,
} from "./account.js";
import { item, menu, nearby, search, venue } from "./catalog.js";
import {
  type CartLine,
  cancelOrder,
  estimate,
  orderStatus,
  planOrder,
  previewOf,
  purchase,
  quoteFor,
} from "./orders.js";
import {
  accessToken,
  type Cfg,
  cfgOf,
  DEF_LAT,
  DEF_LON,
  num,
} from "./shared.js";

/**
 * wolt — Wolt (food and grocery delivery, Israel and global) consumer connector.
 *
 * The catalogue is ANONYMOUS: search, venues, menus, and price estimates all
 * work on a connection that has never been logged in. Ordering is authenticated
 * and rides the mobile app's surface.
 *
 * Login reaches one account through several doors — an emailed code, an emailed
 * magic link, or a phone merged with a social account — and every door that
 * SENDS something needs a fresh passive hCaptcha token minted in a real browser
 * on a wolt.com origin. Redeeming a link is the only send-free step.
 *
 * Money: `order.create` charges the account's saved card and sends real food to
 * a real address, so consent is bound to a total rather than to an intent. A
 * call without `confirm` returns a priced preview and a `quote` fingerprinting
 * the venue, every line, the address, and the payable amount; placing needs
 * `allowOrdering` on the connection, `confirm: true`, and that same quote still
 * pricing identically. A total that moved refuses and reports the new one.
 *
 * Amounts are integer MINOR UNITS throughout: 1800 is ₪18.00.
 */

const STRICT = { additionalProperties: false } as const;

const latSchema = t.Number({
  minimum: -90,
  maximum: 90,
  description: "Latitude. Defaults to the connection's home location.",
});
const lonSchema = t.Number({
  minimum: -180,
  maximum: 180,
  description: "Longitude. Defaults to the connection's home location.",
});
const slugSchema = t.String({
  minLength: 1,
  maxLength: 200,
  description: "Venue slug, from venue.search or venue.listNearby.",
});
const orderIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  description: "Order id returned by order.create.",
});
const captchaSchema = (what: string) =>
  t.String({
    minLength: 1,
    maxLength: 4000,
    description: `Fresh h-captcha-response for ${what}, minted in a real browser on a wolt.com origin. Single use.`,
  });

/**
 * A cart, typed so the shape is visible to whoever is building one and checked
 * before any of it reaches a payment.
 */
const cartSchema = t.Array(
  t.Object(
    {
      id: t.String({
        minLength: 1,
        maxLength: 128,
        description: "Menu item id, from menu.get or item.get.",
      }),
      count: t.Optional(
        t.Integer({
          minimum: 1,
          maximum: 99,
          description: "How many. Default 1.",
        }),
      ),
      options: t.Optional(
        t.Array(
          t.Object(
            {
              id: t.String({
                minLength: 1,
                description:
                  "Option group id from the item's `options[].id`. Groups with required:true must be present.",
              }),
              values: t.Array(
                t.Object(
                  {
                    id: t.String({
                      minLength: 1,
                      description:
                        "Chosen value id from the group's `values[].id`.",
                    }),
                    count: t.Optional(
                      t.Integer({
                        minimum: 1,
                        maximum: 99,
                        description: "Default 1.",
                      }),
                    ),
                  },
                  STRICT,
                ),
                { minItems: 1, description: "The choices made in this group." },
              ),
            },
            STRICT,
          ),
          { description: "Option groups for this line, priced from the menu." },
        ),
      ),
    },
    STRICT,
  ),
  {
    minItems: 1,
    maxItems: 100,
    description:
      "The cart. Every id is validated against the venue's live assortment before anything is priced, so a stale menu fails loudly instead of ordering the wrong thing.",
  },
);

const tipSchema = t.Integer({
  minimum: 0,
  description: "Courier tip in minor units (100 = ₪1.00). Default 0.",
});

function coords(input: Record<string, unknown>, ctx: ActionContext) {
  const cfg: Cfg = cfgOf(ctx);
  return {
    lat: num(input.lat ?? cfg.defaultLat, DEF_LAT),
    lon: num(input.lon ?? cfg.defaultLon, DEF_LON),
  };
}

export default function wolt(rl: RunlinePluginAPI) {
  rl.setName("wolt");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      refreshToken: t.Optional(
        t.String({
          env: "WOLT_REFRESH_TOKEN",
          description:
            "Refresh JWT from an owner login. Rotates on every grant and is rewritten here. Store only in secrets.",
        }),
      ),
      deviceToken: t.Optional(
        t.String({
          env: "WOLT_DEVICE_TOKEN",
          description:
            "Device token bound to the session. Generated if absent.",
        }),
      ),
      visitorId: t.Optional(
        t.String({
          env: "WOLT_VISITOR_ID",
          description: "x-wolt-visitor-id. Generated if absent.",
        }),
      ),
      ravelinDeviceId: t.Optional(
        t.String({
          env: "WOLT_RAVELIN_DEVICE_ID",
          description:
            "Ravelin fraud fingerprint (rvnand-6-<64 hex>). Generated if absent; changing it can fail payments.",
        }),
      ),
      paymentMethodId: t.Optional(
        t.String({
          env: "WOLT_PAYMENT_METHOD_ID",
          description:
            "Saved card charged for orders. Discovered automatically during login.",
        }),
      ),
      defaultLat: t.Optional(
        t.String({
          env: "WOLT_DEFAULT_LAT",
          description:
            "Home latitude for reads that carry none (e.g. 32.0853).",
        }),
      ),
      defaultLon: t.Optional(
        t.String({
          env: "WOLT_DEFAULT_LON",
          description:
            "Home longitude for reads that carry none (e.g. 34.7818).",
        }),
      ),
      allowOrdering: t.Optional(
        t.Boolean({
          default: false,
          description:
            "Master switch for order.create and order.cancel. Off leaves the connection read-only. Even on, order.create still needs confirm:true and a matching quote.",
        }),
      ),
    }),
  );

  /* ---------------------------------------------------------------- */
  /* venue / menu / item — anonymous catalogue                        */
  /* ---------------------------------------------------------------- */

  rl.registerAction("venue.search", {
    access: "read",
    description:
      "Search Wolt for venues — restaurants, groceries, shops — by name or cuisine near a location. Returns slugs, ratings, delivery price and ETA. Anonymous: works with no login. Hebrew works.",
    inputSchema: t.Object(
      {
        query: t.String({
          minLength: 1,
          maxLength: 200,
          description: "Search text, e.g. 'sushi' or 'pharmacy'.",
        }),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
        limit: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 100,
            description: "Max venues. Default 20.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { lat, lon } = coords(p, ctx);
      return search(String(p.query), lat, lon, num(p.limit, 20));
    },
  });

  rl.registerAction("venue.listNearby", {
    access: "read",
    description:
      "The Wolt city front page for a location: venues near you, optionally only the ones open right now. Anonymous.",
    inputSchema: t.Object(
      {
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
        limit: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 100,
            description: "Max venues. Default 30.",
          }),
        ),
        open_only: t.Optional(
          t.Boolean({ description: "Keep only venues currently open." }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const { lat, lon } = coords(p, ctx);
      return nearby(lat, lon, num(p.limit, 30), p.open_only === true);
    },
  });

  rl.registerAction("venue.get", {
    access: "read",
    description:
      "One venue in full: address, currency, whether it is open, ETA, delivery fee, order minimum, and the opening and delivery schedules. Anonymous.",
    inputSchema: t.Object(
      {
        slug: slugSchema,
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { lat, lon } = coords(p, ctx);
      return venue(String(p.slug), lat, lon);
    },
  });

  rl.registerAction("menu.get", {
    access: "read",
    description:
      "A venue's menu: categories and items with prices in minor units, stock, and option groups carrying their required flag, their choices and each choice's price — which is what order.create needs to build a cart. Anonymous.",
    inputSchema: t.Object(
      {
        slug: slugSchema,
        q: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 200,
            description: "Keep only items whose name or description matches.",
          }),
        ),
        limit: t.Optional(
          t.Integer({
            minimum: 0,
            maximum: 500,
            description: "Max items per category. 0 or omitted returns all.",
          }),
        ),
        lang: t.Optional(
          t.String({
            minLength: 2,
            maxLength: 8,
            description: "Assortment language. Default 'en'.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input) {
      const p = input as Record<string, unknown>;
      return menu(
        String(p.slug),
        p.q ? String(p.q) : "",
        num(p.limit, 0),
        p.lang ? String(p.lang) : "en",
      );
    },
  });

  rl.registerAction("item.get", {
    access: "read",
    description:
      "One menu item in full — price, stock, and every option group with its choices. Anonymous.",
    inputSchema: t.Object(
      {
        slug: slugSchema,
        item_id: t.String({
          minLength: 1,
          maxLength: 128,
          description: "Item id, from menu.get.",
        }),
      },
      STRICT,
    ),
    async execute(input) {
      const p = input as Record<string, unknown>;
      return item(String(p.slug), String(p.item_id));
    },
  });

  /* ---------------------------------------------------------------- */
  /* account — the owner login and the session it carries             */
  /* ---------------------------------------------------------------- */

  rl.registerAction("account.requestEmailCode", {
    access: "write",
    description:
      "Email door, step 1: ask Wolt to email a login code and link. Needs a fresh hCaptcha token. Returns sent:false with reason 'not_registered' when no account exists for the address — use the phone door instead. Follow with account.submitCode, or account.redeemLink for the link.",
    inputSchema: t.Object(
      {
        email: t.String({
          minLength: 3,
          maxLength: 320,
          description: "The account's email address.",
        }),
        captcha: t.Optional(captchaSchema("the email_login send")),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as { email: string; captcha?: string };
      return requestEmailCode(ctx, p.email, p.captcha);
    },
  });

  rl.registerAction("account.redeemLink", {
    access: "write",
    description:
      "Redeem an emailed magic link and connect the account. The only login step that sends nothing and needs no captcha. Accepts the whole URL or the bare token; links expire within minutes and are single use.",
    inputSchema: t.Object(
      {
        link: t.String({
          minLength: 8,
          maxLength: 4000,
          description: "The full login URL from the email, or its bare token.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { link } = input as { link: string };
      return redeemLink(ctx, link);
    },
  });

  rl.registerAction("account.loginMethods", {
    access: "read",
    description:
      "Ask Wolt which doors a phone number can log in through, before committing to one. Sends no code and no email.",
    inputSchema: t.Object(
      {
        phone: t.String({
          minLength: 6,
          maxLength: 32,
          description: "Account phone, Israeli local or international digits.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { phone } = input as { phone: string };
      return loginMethods(ctx, phone);
    },
  });

  rl.registerAction("account.requestSmsCode", {
    access: "write",
    description:
      "Phone door, step 1: ask Wolt to text (or WhatsApp) a login code. This is the door that reaches Google and other social accounts, which is what emailToken is for — a magic-link token from any mailbox proves the email half of the merge. Needs fresh hCaptcha tokens for each send. Follow with account.submitCode.",
    inputSchema: t.Object(
      {
        phone: t.String({
          minLength: 6,
          maxLength: 32,
          description: "Account phone, Israeli local or international digits.",
        }),
        emailToken: t.Optional(
          t.String({
            minLength: 8,
            maxLength: 4000,
            description:
              "Magic-link URL or token from an email_login, unlocking the phone-merge path for social accounts.",
          }),
        ),
        email: t.Optional(
          t.String({
            minLength: 3,
            maxLength: 320,
            description:
              "The address that emailToken was sent to, when it differs from the stored one.",
          }),
        ),
        vnCaptcha: t.Optional(
          captchaSchema("validate-number, in the merge path"),
        ),
        smsCaptcha: t.Optional(captchaSchema("the SMS send")),
        viaWhatsapp: t.Optional(
          t.Boolean({
            description: "Deliver the code over WhatsApp instead of SMS.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      return requestSmsCode(ctx, input as Parameters<typeof requestSmsCode>[1]);
    },
  });

  rl.registerAction("account.submitCode", {
    access: "write",
    description:
      "Login step 2: submit the code that was emailed or texted. Connects the account, or reports needs_confirmation:true when Wolt escalates to a second factor — then use account.submitConfirmation.",
    inputSchema: t.Object(
      {
        code: t.String({
          minLength: 3,
          maxLength: 12,
          description: "The one-time code from the email or SMS.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { code } = input as { code: string };
      return submitCode(ctx, code);
    },
  });

  rl.registerAction("account.submitConfirmation", {
    access: "write",
    description:
      "Login step 3, only when account.submitCode reported needs_confirmation: submit the code Wolt emailed as a second factor. On success the session is connected.",
    inputSchema: t.Object(
      {
        code: t.String({
          minLength: 3,
          maxLength: 12,
          description: "The confirmation code from the email.",
        }),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { code } = input as { code: string };
      return submitConfirmation(ctx, code);
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
      "Force a token refresh. Wolt rotates its refresh token on every grant, so an untouched session eventually lapses; a recurring 'call wolt.account.refresh()' every ~12h keeps it alive. Also the cheapest proof that stored credentials still work.",
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
      "The live account behind the session: id, name, saved-address count and the card ordering will charge. Hits Wolt, so it also proves the credentials work — account.status answers from local state alone.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return whoami(ctx);
    },
  });

  rl.registerAction("account.findPaymentMethod", {
    access: "write",
    description:
      "Re-discover the saved card and store it on the connection. Needed only when a card was added after login, since order.create refuses without one.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      const id = await discoverPaymentMethod(ctx);
      return {
        payment_method: id,
        note: id
          ? "Stored; ordering can charge this card."
          : "No usable card on the account — add one in the Wolt app.",
      };
    },
  });

  rl.registerAction("address.list", {
    access: "read",
    description:
      "The account's saved delivery addresses. order.create delivers to the first one unless given an address id.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return listAddresses(ctx);
    },
  });

  /* ---------------------------------------------------------------- */
  /* order — estimating, placing, tracking                            */
  /* ---------------------------------------------------------------- */

  rl.registerAction("order.estimate", {
    access: "read",
    description:
      "What a cart would cost at a venue: delivery fee and totals, without a login and without placing anything. An empty cart still prices the delivery fee. Anonymous.",
    inputSchema: t.Object(
      {
        slug: slugSchema,
        items: t.Optional(cartSchema),
        method: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 40,
            description: "Delivery method. Default 'homedelivery'.",
          }),
        ),
        tip: t.Optional(tipSchema),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { lat, lon } = coords(p, ctx);
      const detail = await venue(String(p.slug), lat, lon);
      return estimate(
        detail,
        (p.items as CartLine[]) ?? [],
        p.method ? String(p.method) : "homedelivery",
        num(p.tip, 0),
      );
    },
  });

  rl.registerAction("order.create", {
    access: "write",
    description:
      "Place a REAL, paid Wolt order: this charges the saved card and sends food to a real address. Call it first WITHOUT confirm to get a priced preview — every line, delivery fee, tip, payable total, ETA, and where it is going — plus a `quote`. Read the total and the address back to the person, get an explicit yes, then call again with confirm:true and that exact quote. If the total moved in between, nothing is ordered and the new total comes back instead, because consent was given to a price. Needs allowOrdering on the connection.",
    inputSchema: t.Object(
      {
        slug: slugSchema,
        items: cartSchema,
        address: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 128,
            description:
              "Delivery address id from address.list. Defaults to the first saved address.",
          }),
        ),
        tip: t.Optional(tipSchema),
        confirm: t.Optional(
          t.Boolean({
            description:
              "True only after a person heard the total and the address and said yes. Must be sent with the quote from the preview call.",
          }),
        ),
        quote: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 64,
            description:
              "The quote from the preview call. Binds this order to the exact total that was approved.",
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
      // A confirmation that ordering will refuse is decided before pricing it.
      if (p.confirm === true && !cfg.allowOrdering)
        throw new Error(
          "wolt order.create: ordering is disabled for this connection (set allowOrdering:true). Refusing to place.",
        );
      const { lat, lon } = coords(p, ctx);
      const slug = String(p.slug);
      const [detail, addresses] = await Promise.all([
        venue(slug, lat, lon),
        listAddresses(ctx),
      ]);
      const plan = await planOrder(
        ctx,
        detail,
        addresses,
        p.address ? String(p.address) : undefined,
        slug,
        p.items as CartLine[],
        num(p.tip, 0),
      );
      const quote = quoteFor(plan);
      const summary = previewOf(plan);

      if (p.confirm !== true) {
        return {
          requiresConfirmation: true,
          action: "order.create",
          quote,
          summary,
          note: cfg.allowOrdering
            ? "Places a REAL order and charges the saved card. Read the total and the address back to the person, then re-run with confirm:true and this quote."
            : "Ordering is disabled for this connection (allowOrdering is false), so this preview cannot be placed. Enable allowOrdering first.",
        };
      }
      if (p.quote !== quote) {
        return {
          ordered: false,
          reason: p.quote ? "price_changed" : "quote_required",
          quote,
          summary,
          note: p.quote
            ? "The total changed since the quote that was approved, so nothing was ordered. Read the new total back and confirm again with the new quote."
            : "confirm:true must carry the quote from the preview call, so a person can only approve a total they were shown. Nothing was ordered.",
        };
      }
      const placed = await purchase(ctx, plan);
      return {
        ordered: placed.order_id !== null,
        status: placed.order_id !== null ? "placed" : "unconfirmed",
        order_id: placed.order_id,
        summary,
        ...(placed.order_id
          ? { track_with: `order.status({ order_id: "${placed.order_id}" })` }
          : {
              note: "Wolt accepted the request but returned no order id. Check order history in the app before ordering again.",
            }),
      };
    },
  });

  rl.registerAction("order.status", {
    access: "read",
    description:
      "Track an order — 'where is my food'. Status, ETA, courier position and hand-off code, delivery distance, and how long to wait before polling again.",
    inputSchema: t.Object({ order_id: orderIdSchema }, STRICT),
    async execute(input, ctx) {
      const { order_id } = input as { order_id: string };
      return orderStatus(ctx, order_id);
    },
  });

  rl.registerAction("order.cancel", {
    access: "write",
    description:
      "Cancel an order, which only works in the short window BEFORE the venue accepts it. After that Wolt refuses with error_code 4051 and only support can help — this reports that as cancelled:false rather than throwing. Needs allowOrdering on the connection.",
    inputSchema: t.Object(
      {
        order_id: orderIdSchema,
        reason: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 100,
            description: "Cancellation reason. Default 'ordered_by_mistake'.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { order_id, reason } = input as {
        order_id: string;
        reason?: string;
      };
      if (!cfgOf(ctx).allowOrdering)
        throw new Error(
          "wolt order.cancel: ordering is disabled for this connection (set allowOrdering:true).",
        );
      return cancelOrder(ctx, order_id, reason ?? "ordered_by_mistake");
    },
  });
}
