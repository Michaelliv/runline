import { createHash, randomUUID } from "node:crypto";
import type { ActionContext } from "runline";
import { type Address, selectAddress } from "./account.js";
import {
  assortment,
  itemsById,
  optionDefinitions,
  type VenueDetail,
} from "./catalog.js";
import {
  arr,
  authed,
  CONSUMER,
  cfgOf,
  http,
  numOrNull,
  obj,
  pick,
  RESTAURANT,
  seg,
  WoltError,
} from "./shared.js";

/**
 * Pricing a cart, the quote that binds a confirmation to a total, and placing
 * or cancelling the order. Amounts are integer minor units throughout.
 */

export interface CartValue {
  id: string;
  count?: number;
}
export interface CartOption {
  id: string;
  values: CartValue[];
}
export interface CartLine {
  id: string;
  count?: number;
  options?: CartOption[];
}

/**
 * Wolt wants the same cart twice in two different shapes: `menu_items` for the
 * checkout, `items` for the purchase. Both are derived here from one resolution
 * pass so a price can never be computed one way and charged the other.
 */
export interface ResolvedCart {
  menu_items: Record<string, unknown>[];
  purchase_items: Record<string, unknown>[];
  lines: Array<{
    id: string;
    name: string | null;
    count: number;
    amount: number;
  }>;
}

export async function resolveCart(
  slug: string,
  cart: CartLine[],
): Promise<ResolvedCart> {
  const a = await assortment(slug);
  const items = itemsById(a);
  const definitions = optionDefinitions(a);
  const categoryOfItem = new Map<string, string>();
  for (const c of arr(a.categories)) {
    const category = obj(c);
    const categoryId = pick(category.id);
    if (!categoryId) continue;
    for (const id of arr(category.item_ids)) {
      const itemId = pick(id);
      if (itemId && !categoryOfItem.has(itemId))
        categoryOfItem.set(itemId, categoryId);
    }
  }

  const menu_items: Record<string, unknown>[] = [];
  const purchase_items: Record<string, unknown>[] = [];
  const lines: ResolvedCart["lines"] = [];

  for (const line of cart) {
    const item = items.get(line.id);
    if (!item) throw new Error(`wolt: item ${line.id} is not on venue ${slug}`);
    const count = line.count ?? 1;
    const categoryId = categoryOfItem.get(line.id) ?? null;
    const basePrice = numOrNull(item.price) ?? 0;

    let optionsTotal = 0;
    const checkoutOptions: Record<string, unknown>[] = [];
    const purchaseOptions: Record<string, unknown>[] = [];
    for (const group of line.options ?? []) {
      const onItem = arr(item.options)
        .map(obj)
        .find((o) => pick(o.id) === group.id);
      if (!onItem)
        throw new Error(
          `wolt: option group ${group.id} is not on item ${line.id}`,
        );
      const definition = obj(definitions.get(pick(onItem.option_id) ?? ""));
      const values = group.values.map((v) => {
        const declared = arr(definition.values)
          .map(obj)
          .find((d) => pick(d.id) === v.id);
        if (!declared)
          throw new Error(
            `wolt: option ${v.id} is not a choice in group ${group.id}`,
          );
        const price = numOrNull(declared.price) ?? 0;
        const valueCount = v.count ?? 1;
        optionsTotal += price * valueCount;
        return { id: v.id, price, count: valueCount };
      });
      checkoutOptions.push({ id: group.id, values });
      purchaseOptions.push({
        id: { $oid: group.id },
        type: pick(definition.type) ?? "Multichoice",
        values: values.map((v) => ({
          id: { $oid: v.id },
          price: v.price,
          count: v.count,
        })),
      });
    }

    const amount = (basePrice + optionsTotal) * count;
    menu_items.push({
      id: line.id,
      count,
      options: checkoutOptions,
      base_price: basePrice,
      end_amount: amount,
      category_id: categoryId,
      category_ids: categoryId ? [categoryId] : [],
      exclude_from_discounts: false,
      exclude_from_discounts_min_basket: false,
      exclude_from_credits: false,
      alcohol_permille: numOrNull(item.alcohol_permille) ?? 0,
      restrictions: [],
    });
    purchase_items.push({
      id: { $oid: line.id },
      baseprice: basePrice,
      options: purchaseOptions,
      count,
      end_amount: amount,
      alcohol_percentage: 0,
      checksum: pick(item.checksum),
      substitution_settings: { is_allowed: true },
      from_recommendation: false,
    });
    lines.push({ id: line.id, name: pick(item.name), count, amount });
  }
  return { menu_items, purchase_items, lines };
}

export async function estimate(
  venue: VenueDetail,
  cart: CartLine[],
  method: string,
  tip: number,
) {
  const menuItems = cart.map((line) => ({
    id: line.id,
    count: line.count ?? 1,
    options: line.options ?? [],
  }));
  const r = await http(
    CONSUMER,
    "/order-xp/web/v1/pages/venue/pricing-estimates",
    {
      method: "POST",
      body: {
        purchase_plan: {
          venue: {
            id: venue.id,
            country: venue.country,
            currency: venue.currency,
          },
          delivery_method: method,
          menu_items: menuItems,
          courier_tip: tip,
          use_promo_discount_ids: [],
        },
      },
    },
  );
  return {
    venue: { id: venue.id, slug: venue.slug, name: venue.name },
    currency: venue.currency,
    items: menuItems,
    estimate: r,
  };
}

async function checkout(
  ctx: ActionContext,
  venue: VenueDetail,
  address: Address,
  menuItems: Record<string, unknown>[],
  tip: number,
): Promise<Record<string, unknown>> {
  const cfg = cfgOf(ctx);
  const [longitude, latitude] = address.coordinates ?? [null, null];
  return authed(ctx, CONSUMER, "/order-xp/mobile/v2/pages/checkout", {
    method: "POST",
    body: {
      purchase_plan: {
        delivery: {
          delivery_coordinates: { latitude, longitude },
          delivery_info_id: address.id,
        },
        venue: {
          id: venue.id,
          country: venue.country,
          currency: venue.currency,
        },
        delivery_method: "homedelivery",
        menu_items: menuItems,
        use_cash: false,
        selected_offer_ids: [],
        pre_considered_discount_ids: [],
        courier_tip: tip,
        use_loyalty_points_amount: 0,
        use_credits_and_tokens: true,
        did_client_disable_purchase: false,
        payment_methods: cfg.paymentMethodId
          ? [{ id: cfg.paymentMethodId, type: "card" }]
          : [],
        delivery_config: { method: "homedelivery", schedule: "standard" },
        is_partial_address: false,
      },
    },
  });
}

function deliveryEstimate(
  checkoutBody: Record<string, unknown>,
  venue: VenueDetail,
): string {
  const configs = arr(checkoutBody.delivery_configs).map(obj);
  const chosen =
    configs.find(
      (c) =>
        pick(c.method) === "homedelivery" &&
        pick(c.schedule) === "standard" &&
        numOrNull(obj(c.estimate).max) !== null,
    ) ?? configs.find((c) => numOrNull(obj(c.estimate).max) !== null);
  const range = obj(chosen?.estimate);
  const min = numOrNull(range.min);
  const max = numOrNull(range.max);
  if (min !== null && max !== null) return `${min}-${max}`;
  const declared = obj(venue.estimate_range);
  const dmin = numOrNull(declared.min);
  const dmax = numOrNull(declared.max);
  if (dmin !== null && dmax !== null) return `${dmin}-${dmax}`;
  const single = venue.live_estimate_minutes ?? venue.estimate_minutes;
  return single !== null ? `${single}-${single + 10}` : "30-45";
}

export interface Plan {
  venue: VenueDetail;
  address: Address;
  cart: ResolvedCart;
  checkout: Record<string, unknown>;
  /** Always a real number: an order nobody can price is never planned. */
  payable_amount: number;
  delivery_price: number | null;
  estimate_minutes: string;
  tip: number;
}

export async function planOrder(
  ctx: ActionContext,
  venue: VenueDetail,
  addresses: Address[],
  wantedAddress: string | undefined,
  slug: string,
  cart: CartLine[],
  tip: number,
): Promise<Plan> {
  const address = selectAddress(addresses, wantedAddress);
  const resolved = await resolveCart(slug, cart);
  const body = await checkout(ctx, venue, address, resolved.menu_items, tip);
  if (body.purchasing_disabled === true) {
    const reason =
      pick(obj(body.call_to_action).text) ??
      "Wolt has disabled purchasing here";
    throw new Error(`wolt: this order cannot be placed — ${reason}`);
  }
  const validation = obj(body.purchase_validation);
  const payable =
    numOrNull(validation.end_amount) ?? numOrNull(body.payable_amount);
  // Without a total there is nothing to show a person and nothing to bind a
  // confirmation to, and the purchase would post a null amount.
  if (payable === null)
    throw new Error(
      "wolt: the checkout returned no payable amount, so this order cannot be priced",
    );
  return {
    venue,
    address,
    cart: resolved,
    checkout: body,
    payable_amount: payable,
    delivery_price: numOrNull(validation.delivery_price),
    estimate_minutes: deliveryEstimate(body, venue),
    tip,
  };
}

/**
 * A fingerprint of everything a person agrees to when they say yes: the venue,
 * every line and its amount, where it is going, and the total. Re-derived on the
 * confirming call, so a total that moved in between cannot be charged against
 * the old consent.
 */
export function quoteFor(plan: Plan): string {
  const material = JSON.stringify([
    plan.venue.id ?? plan.venue.slug ?? "",
    plan.address.id ?? "",
    plan.cart.lines.map((l) => [l.id, l.count, l.amount]),
    plan.payable_amount,
    plan.venue.currency ?? "",
    plan.tip,
  ]);
  return `q_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

export function previewOf(plan: Plan) {
  return {
    venue: {
      id: plan.venue.id,
      slug: plan.venue.slug,
      name: plan.venue.name,
    },
    deliver_to: {
      id: plan.address.id,
      address: plan.address.address,
      city: plan.address.city,
    },
    items: plan.cart.lines,
    delivery_price: plan.delivery_price,
    tip: plan.tip,
    payable_amount: plan.payable_amount,
    currency: plan.venue.currency,
    estimate_minutes: plan.estimate_minutes,
  };
}

export async function purchase(ctx: ActionContext, plan: Plan) {
  const cfg = cfgOf(ctx);
  if (!cfg.paymentMethodId)
    throw new Error(
      "wolt: no saved card (paymentMethodId) — a saved card is required, Google Pay cannot be replayed headless",
    );
  const validation = obj(plan.checkout.purchase_validation);
  const [longitude, latitude] = plan.address.coordinates ?? [null, null];
  const r = await authed(ctx, RESTAURANT, "/v2/purchases", {
    method: "POST",
    body: {
      venue_id: plan.venue.id,
      checkout_id: plan.checkout.id,
      payment_method_id: cfg.paymentMethodId,
      payment_method_type: "card",
      end_amount: plan.payable_amount,
      end_amount_rounding: numOrNull(validation.end_amount_rounding) ?? 0,
      items: plan.cart.purchase_items,
      client_pre_estimate: plan.estimate_minutes,
      signature_datetime: { $date: Date.now() },
      client_nonce: randomUUID(),
      delivery_method: "homedelivery",
      currency: plan.venue.currency,
      preorder: false,
      no_credits_or_tokens: false,
      credits_amount: numOrNull(validation.credits_amount) ?? 0,
      delivery_price: plan.delivery_price ?? 0,
      delivery_info: {
        id: { $oid: plan.address.id },
        delivery_comments: "\n",
        location: {
          address: plan.address.address,
          city: plan.address.city,
          coordinates: { coordinates: [longitude, latitude], type: "Point" },
        },
        use_last_100m_address_picker: true,
      },
      tip_amount: plan.tip,
      language: "en",
      additional_checkout_options: { no_contact_delivery: false },
      ravelin_device_id: cfg.ravelinDeviceId,
      browser_info: {
        color_depth: 32,
        screen_width: 1080,
        screen_height: 2400,
        time_zone_offset: -180,
        java_enabled: false,
        language: "en",
        ravelin_device_id: cfg.ravelinDeviceId,
      },
      to: { id: { $oid: plan.venue.id }, type: "venue" },
      signature: "N/A",
      type: "purchase",
      device_channel: "app",
      pricing_model_version: 2023,
      use_self_service_cancellation: false,
      discounts: arr(validation.discounts),
      surcharges: arr(validation.surcharges),
      offers: arr(validation.offers),
      menu_items_source: "consumer-assortment",
    },
  });
  const first = obj(Array.isArray(r.results) ? r.results[0] : r.results);
  const orderId = pick(
    obj(first.id).$oid,
    first.id,
    obj(r.id).$oid,
    r.id,
    r.purchase_id,
  );
  return { order_id: orderId };
}

export async function orderStatus(ctx: ActionContext, orderId: string) {
  const id = seg(orderId, "order_id");
  const [tracking, page] = await Promise.all([
    authed(ctx, RESTAURANT, `/v2/order_details/purchase_tracking/${id}`),
    authed(ctx, CONSUMER, `/order-xp/v1/pages/order-tracking/${id}`).catch(
      () => null,
    ),
  ]);
  const details = obj(tracking.order_details);
  const context = obj(obj(page ?? {}).purchase_context);
  const eta = numOrNull(obj(details.delivery_eta).$date);
  return {
    order_id: orderId,
    status: pick(context.purchase_status),
    venue: pick(context.venue_name),
    eta: eta !== null ? new Date(eta).toISOString() : null,
    delivery_distance: numOrNull(details.delivery_distance),
    handshake_code: pick(details.delivery_handshake_code),
    couriers: arr(tracking.drivers).map((d) => ({
      name: pick(obj(d).name),
      coordinates: obj(d).coordinates ?? obj(d).location ?? null,
    })),
    currency: pick(details.currency),
    poll_after_seconds: numOrNull(tracking.expires_in_seconds),
  };
}

export async function cancelOrder(
  ctx: ActionContext,
  orderId: string,
  reason: string,
) {
  const id = seg(orderId, "order_id");
  try {
    await authed(ctx, RESTAURANT, `/v2/purchases/${id}/cancel`, {
      method: "PUT",
      body: { cancellation_reason: reason },
    });
    return { cancelled: true, order_id: orderId, reason };
  } catch (e) {
    // A refusal is the normal outcome once the venue has accepted, so it comes
    // back as an answer rather than an exception. error_code 4051 is that case.
    if (!(e instanceof WoltError)) throw e;
    const code = numOrNull(e.details().error_code);
    return {
      cancelled: false,
      order_id: orderId,
      error_code: code,
      note:
        code === 4051
          ? "The venue already accepted this order, so self-service cancellation is closed. Wolt support can still help."
          : "Wolt refused the cancellation.",
    };
  }
}
