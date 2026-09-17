import {
  arr,
  CONSUMER,
  http,
  numOrNull,
  obj,
  pick,
  RESTAURANT,
  seg,
} from "./shared.js";

/**
 * The anonymous catalogue: venues, menus, and a price estimate.
 *
 * None of this needs a login, so these reads work on a connection that has
 * never been connected. Prices throughout are integer MINOR UNITS — 1800 is
 * ₪18.00 — because that is what the API returns and rounding it here would
 * lose money somewhere downstream.
 */

export interface Venue {
  id: string | null;
  slug: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  currency: string | null;
  online: boolean | null;
  rating: number | null;
  estimate_minutes: number | null;
  delivery_price: number | null;
  tags: string[];
  categories: string[];
}

export interface OptionValue {
  id: string | null;
  name: string | null;
  price: number;
}

export interface OptionGroup {
  id: string | null;
  option_id: string | null;
  name: string | null;
  required: boolean;
  min: number | null;
  max: number | null;
  values: OptionValue[];
}

export interface MenuItem {
  id: string | null;
  name: string | null;
  description: string | null;
  price: number | null;
  in_stock: boolean;
  image: string | null;
  checksum: string | null;
  options: OptionGroup[];
}

const strings = (values: unknown[]): string[] =>
  values.map((v) => pick(v)).filter((v): v is string => v !== null);

function venueOf(raw: unknown): Venue {
  const v = obj(raw);
  return {
    id: pick(v.id),
    slug: pick(v.slug),
    name: pick(v.name),
    address: pick(v.address),
    city: pick(v.city),
    country: pick(v.country),
    currency: pick(v.currency),
    online: typeof v.online === "boolean" ? v.online : null,
    rating: numOrNull(obj(v.rating).score),
    estimate_minutes: numOrNull(v.estimate),
    delivery_price: numOrNull(v.delivery_price_int),
    tags: strings(arr(v.tags)),
    categories: strings(arr(v.categories).map((c) => obj(c).name)),
  };
}

function collectVenues(page: Record<string, unknown>): Venue[] {
  const out: Venue[] = [];
  for (const section of arr(page.sections))
    for (const item of arr(obj(section).items)) {
      const venue = obj(item).venue;
      if (venue) out.push(venueOf(venue));
    }
  return out;
}

export async function search(
  query: string,
  lat: number,
  lon: number,
  limit: number,
) {
  const page = await http(RESTAURANT, "/v1/pages/search", {
    method: "POST",
    body: { q: query, target: "venues", lat, lon },
  });
  const venues = collectVenues(page).slice(0, limit);
  return { query, count: venues.length, venues };
}

export async function nearby(
  lat: number,
  lon: number,
  limit: number,
  openOnly: boolean,
) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const page = await http(RESTAURANT, `/v1/pages/restaurants?${params}`);
  const all = collectVenues(page);
  const venues = openOnly ? all.filter((v) => v.online) : all;
  return {
    city: pick(page.city),
    total: venues.length,
    venues: venues.slice(0, limit),
  };
}

/** A venue's static page plus its live status; the live half is best-effort. */
export async function venue(slug: string, lat: number, lon: number) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const name = seg(slug, "slug");
  const [staticPage, dynamic] = await Promise.all([
    http(
      CONSUMER,
      `/order-xp/web/v1/pages/venue/slug/${name}/static?${params}`,
    ),
    http(
      CONSUMER,
      `/order-xp/web/v1/venue/slug/${name}/dynamic/?selected_delivery_method=homedelivery`,
    ).catch(() => null),
  ]);
  const v = obj(staticPage.venue);
  const live = obj(obj(dynamic ?? {}).venue);
  return {
    ...venueOf(v),
    description: pick(v.description),
    timezone: pick(v.timezone),
    phone: pick(v.phone),
    website: pick(v.website),
    active_menu: v.active_menu ?? null,
    delivery_methods: arr(v.delivery_methods),
    delivery_base_price: numOrNull(v.delivery_base_price),
    service_fee_estimate: numOrNull(v.service_fee_estimate),
    order_minimum: numOrNull(staticPage.order_minimum),
    opening_times: v.opening_times_schedule ?? null,
    delivery_times: v.delivery_times_schedule ?? null,
    is_open: typeof live.online === "boolean" ? live.online : null,
    live_estimate_minutes: numOrNull(live.estimate),
    estimate_range: v.estimate_range ?? null,
  };
}

export type VenueDetail = Awaited<ReturnType<typeof venue>>;

export async function assortment(
  slug: string,
  language = "en",
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ language });
  return http(
    CONSUMER,
    `/consumer-api/consumer-assortment/v1/venues/slug/${seg(slug, "slug")}/assortment?${params}`,
  );
}

function optionGroupOf(
  raw: unknown,
  definitions: Map<string, Record<string, unknown>>,
): OptionGroup {
  const group = obj(raw);
  const definition = obj(definitions.get(pick(group.option_id) ?? ""));
  const range = obj(obj(group.multi_choice_config).total_range);
  const min = numOrNull(range.min);
  return {
    id: pick(group.id),
    option_id: pick(group.option_id),
    name: pick(group.name, definition.name),
    required: (min ?? 0) > 0,
    min,
    max: numOrNull(range.max),
    values: arr(definition.values).map((v) => {
      const value = obj(v);
      return {
        id: pick(value.id),
        name: pick(value.name),
        price: numOrNull(value.price) ?? 0,
      };
    }),
  };
}

export function menuItemOf(
  raw: unknown,
  definitions: Map<string, Record<string, unknown>>,
): MenuItem {
  const item = obj(raw);
  const balance = numOrNull(item.purchasable_balance);
  return {
    id: pick(item.id),
    name: pick(item.name),
    description: pick(item.description),
    price: numOrNull(item.price),
    in_stock: balance === null ? true : balance > 0,
    image: pick(obj(arr(item.images)[0]).url),
    checksum: pick(item.checksum),
    options: arr(item.options).map((o) => optionGroupOf(o, definitions)),
  };
}

/** Option definitions keyed by id; the item payload only carries references. */
export function optionDefinitions(
  a: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  return new Map(
    arr(a.options).map((o) => [pick(obj(o).id) ?? "", obj(o)] as const),
  );
}

export function itemsById(
  a: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  return new Map(
    arr(a.items).map((i) => [pick(obj(i).id) ?? "", obj(i)] as const),
  );
}

export async function menu(
  slug: string,
  filter: string,
  perCategory: number,
  language: string,
) {
  const a = await assortment(slug, language);
  const items = itemsById(a);
  const definitions = optionDefinitions(a);
  const needle = filter.toLowerCase();
  const matches = (item: MenuItem) =>
    !needle ||
    (item.name ?? "").toLowerCase().includes(needle) ||
    (item.description ?? "").toLowerCase().includes(needle);

  const categories = arr(a.categories)
    .map((c) => {
      const category = obj(c);
      const shaped = arr(category.item_ids)
        .map((id) => items.get(pick(id) ?? ""))
        .filter((i): i is Record<string, unknown> => i !== undefined)
        .map((i) => menuItemOf(i, definitions))
        .filter(matches);
      return {
        id: pick(category.id),
        name: pick(category.name),
        slug: pick(category.slug),
        description: pick(category.description),
        items: perCategory > 0 ? shaped.slice(0, perCategory) : shaped,
        item_count: shaped.length,
      };
    })
    .filter((c) => c.item_count > 0);

  return {
    venue_slug: slug,
    assortment_id: pick(a.assortment_id),
    language: pick(a.selected_language),
    category_count: categories.length,
    item_count: categories.reduce((n, c) => n + c.item_count, 0),
    categories,
  };
}

export async function item(slug: string, itemId: string): Promise<MenuItem> {
  const a = await assortment(slug);
  const found = itemsById(a).get(itemId);
  if (!found) throw new Error(`wolt: item ${itemId} is not on venue ${slug}`);
  return menuItemOf(found, optionDefinitions(a));
}
