import { createHash, randomUUID } from "node:crypto";
import type { ActionContext } from "runline";
import { flat, type Place, resolve, stop } from "./places.js";
import { createSession } from "./session.js";
import { arr, authed, cfgOf, numOrNull, obj, pick } from "./shared.js";

/** Pricing, the quote that binds a confirmation to a fare, and the booking itself. */

export interface RideClass {
  class_uuid: string | null;
  name: string | null;
  category: string | null;
  subcategory: string;
  estimation_id: string | null;
  display_price: string | null;
  currency: string | null;
  eta: number | null;
}

export interface Plan {
  from: Place;
  to: Place;
  stops: [ReturnType<typeof stop>, ReturnType<typeof stop>];
  route_id: string | null;
  classes: RideClass[];
  chosen: RideClass;
}

function rideClassOf(raw: unknown): RideClass {
  const entry = obj(raw);
  const klass = obj(entry.class);
  const option = obj(arr(obj(entry.price).pricing_options)[0]);
  return {
    class_uuid: pick(klass.uuid),
    name: pick(klass.name),
    category: pick(klass.category),
    subcategory: pick(klass.subcategory) ?? "default",
    estimation_id: pick(option.estimation_id),
    display_price: pick(option.user_price, option.full_price),
    currency: pick(option.currency_iso),
    eta: numOrNull(klass.display_eta ?? klass.eta),
  };
}

async function preorder(
  ctx: ActionContext,
  stops: Plan["stops"],
): Promise<{
  classes: RideClass[];
  route_id: string | null;
  default_class: string | null;
}> {
  const cfg = cfgOf(ctx);
  const r = await authed(ctx, "/gl/api/v1/preorder/aggregated", {
    method: "POST",
    body: {
      stops,
      phone: cfg.phone,
      country_code: "IL",
      category: "transportation",
      payment_type: "credit_card",
      source: "mobile",
    },
  });
  const classes = arr(r.classes_with_prices).map(rideClassOf);
  return {
    classes,
    route_id: pick(obj(arr(r.routes)[0]).uuid),
    default_class:
      pick(r.private_default_class_uuid) ?? classes[0]?.class_uuid ?? null,
  };
}

/**
 * Resolve both ends, price every class, and pick one. Every pricing read and
 * every booking goes through here, so a preview and its confirmation are priced
 * by identical code.
 */
export async function plan(
  ctx: ActionContext,
  from: string,
  to: string,
  lat: number,
  lon: number,
  classUuid?: string,
): Promise<Plan> {
  await createSession(ctx, lat, lon);
  const [origin, destination] = await Promise.all([
    resolve(ctx, from, lat, lon),
    resolve(ctx, to, lat, lon),
  ]);
  const stops: Plan["stops"] = [
    stop(origin, "origin", ctx),
    stop(destination, "destination", ctx),
  ];
  const pricing = await preorder(ctx, stops);
  const chosen = classUuid
    ? pricing.classes.find((c) => c.class_uuid === classUuid)
    : (pricing.classes.find((c) => c.class_uuid === pricing.default_class) ??
      pricing.classes[0]);
  if (!chosen)
    throw new Error(
      classUuid
        ? `gett: ride class ${classUuid} is not available for this route`
        : "gett: no ride class available for this route",
    );
  return {
    from: origin,
    to: destination,
    stops,
    route_id: pricing.route_id,
    classes: pricing.classes,
    chosen,
  };
}

/**
 * A fingerprint of everything a person agrees to when they say yes: both
 * endpoints, the ride class, and the fare. Re-derived on the confirming call,
 * so a fare that moved in between cannot be booked against the old consent.
 */
export function quoteFor(ride: Plan): string {
  const material = JSON.stringify([
    ride.from.place_id ?? ride.from.name ?? "",
    ride.to.place_id ?? ride.to.name ?? "",
    ride.chosen.class_uuid ?? "",
    ride.chosen.display_price ?? "",
    ride.chosen.currency ?? "",
  ]);
  return `q_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

export function previewOf(ride: Plan) {
  return {
    from: { name: ride.from.name, address: ride.from.full_address },
    to: { name: ride.to.name, address: ride.to.full_address },
    ride_class: ride.chosen.name,
    price: ride.chosen.display_price,
    currency: ride.chosen.currency,
    eta_to_pickup: ride.chosen.eta,
    class_uuid: ride.chosen.class_uuid,
  };
}

export function optionsOf(ride: Plan) {
  return ride.classes.map((c) => ({
    ride_class: c.name,
    price: c.display_price,
    currency: c.currency,
    eta: c.eta,
    class_uuid: c.class_uuid,
  }));
}

export async function book(ctx: ActionContext, ride: Plan, note?: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.creditCardId)
    throw new Error(
      "gett: no saved card (creditCardId) — re-run the owner login to discover it",
    );
  const body = {
    stops: ride.stops,
    division_name: ride.chosen.name || "Taxi",
    route_id: ride.route_id,
    route_provider: "google",
    ofse_order_flow: false,
    origin: flat(ride.from),
    destination: flat(ride.to),
    note_to_driver: note ?? "",
    business: 0,
    token: randomUUID(),
    app_provider: "gettaxi",
    user_current_time: Math.floor(Date.now() / 1000),
    credit_card_id: cfg.creditCardId,
    payment_type: "credit_card",
    ordered_from: "Phone",
    division_uuid: ride.chosen.class_uuid,
    category: ride.chosen.category ?? "transportation",
    subcategory: ride.chosen.subcategory,
    fix_charge_opt_out: true,
    estimation_id: ride.chosen.estimation_id,
    show_class_pricing_info: false,
    timezone_id: "Asia/Jerusalem",
  };
  const r = await authed(ctx, "/il/global-ride-request/api/v1/create", {
    method: "POST",
    body,
  });
  return {
    ok: r.rc === 0 || pick(r.status) === "success",
    order_id: pick(obj(r.order).id, r.order_id),
  };
}
