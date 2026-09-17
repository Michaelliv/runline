import type { ActionContext } from "runline";
import { rider } from "./session.js";
import {
  arr,
  authed,
  DEF_LAT,
  DEF_LON,
  num,
  numOrNull,
  obj,
  pick,
} from "./shared.js";

/**
 * Place lookup: autocomplete for candidates, retrieve for the full address a
 * booking needs. Both provider shapes are normalized here so nothing downstream
 * reads raw response JSON.
 */

export interface Candidate {
  id: string;
  place_id: string | null;
  provider: string;
  name: string | null;
  secondary: string | null;
  full_address: string | null;
  lat: number | null;
  lng: number | null;
  type: string;
}

export interface Place {
  place_id: string | null;
  provider: string;
  name: string | null;
  full_address: string | null;
  lat: number | null;
  lng: number | null;
  type: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
}

function candidateOf(raw: unknown): Candidate {
  const entry = obj(raw);
  const loc = obj(entry.location);
  const poi = obj(loc.poi);
  return {
    id: pick(entry.id) ?? "",
    place_id: pick(entry.provider_place_id, poi.id),
    provider: (pick(entry.provider, poi.provider) ?? "GOOGLE").toUpperCase(),
    name: pick(loc.main_text, poi.name, loc.title),
    secondary: pick(loc.secondary_text),
    full_address: pick(loc.complete_address, loc.title, loc.main_text),
    lat: numOrNull(loc.lat),
    lng: numOrNull(loc.lng),
    type: pick(loc.type) ?? "point_of_interest",
  };
}

export async function search(
  ctx: ActionContext,
  query: string,
  lat: number,
  lon: number,
): Promise<Candidate[]> {
  const body = {
    autocomplete_query: {
      input: query,
      locale: "en",
      coordinates: { lat: num(lat, DEF_LAT), lng: num(lon, DEF_LON) },
      providers: [
        { name: "google", limit: 6 },
        { name: "gett", limit: 6 },
      ],
    },
  };
  const r = await authed(
    ctx,
    "/gl/locations-proxy/api/v2/locations/autocomplete",
    { method: "POST", body },
  );
  return arr(r.locations)
    .map(candidateOf)
    .filter((c) => c.name !== null);
}

function placeOf(raw: unknown, fallback: Candidate): Place {
  const entry = obj(raw);
  const loc = obj(entry.location);
  const parts = obj(loc.components);
  const poi = obj(loc.poi);
  return {
    place_id: pick(entry.provider_place_id, poi.id) ?? fallback.place_id,
    provider: (pick(entry.provider) ?? fallback.provider).toUpperCase(),
    name: pick(loc.main_text, poi.name) ?? fallback.name,
    full_address:
      pick(loc.complete_address, loc.title) ?? fallback.full_address,
    lat: numOrNull(loc.lat) ?? fallback.lat,
    lng: numOrNull(loc.lng) ?? fallback.lng,
    type: pick(loc.type) ?? fallback.type ?? "establishment",
    city: pick(parts.locality, loc.secondary_text) ?? "",
    state: pick(parts.state) ?? "",
    country: pick(parts.country) ?? "Israel",
    country_code: pick(parts.country_code) ?? "IL",
  };
}

/** Promote a candidate to a full place; the candidate stands in if retrieve is empty. */
async function retrieve(
  ctx: ActionContext,
  candidate: Candidate,
): Promise<Place> {
  const body = {
    locations: [
      {
        id: candidate.id,
        provider_place_Id: candidate.place_id,
        provider: candidate.provider,
        locale: "en",
        location: {
          poi: { provider: candidate.provider, name: candidate.name },
        },
      },
    ],
  };
  const r = await authed(ctx, "/gl/locations-proxy/api/v1/locations/retrieve", {
    method: "POST",
    body,
  });
  const [first] = arr(r.locations);
  return placeOf(first, candidate);
}

export async function resolve(
  ctx: ActionContext,
  query: string,
  lat: number,
  lon: number,
): Promise<Place> {
  const candidates = await search(ctx, query, lat, lon);
  if (!candidates.length)
    throw new Error(`gett: no place found for "${query}"`);
  // Google candidates carry the place id the booking payload wants.
  const best =
    candidates.find((c) => c.provider === "GOOGLE" && c.place_id) ??
    candidates[0];
  return retrieve(ctx, best);
}

/** A stop as the pricing and booking payloads expect it. */
export function stop(
  place: Place,
  kind: "origin" | "destination",
  ctx: ActionContext,
) {
  const established = !!place.place_id;
  return {
    actions: [
      { type: kind === "origin" ? "pick_up" : "drop_off", user: rider(ctx) },
    ],
    location: {
      address: {
        city: place.city,
        country: place.country,
        full_address: place.full_address ?? place.name ?? "",
        poi: established,
        poi_name: place.name ?? "",
        state: place.state,
        title: place.full_address ?? place.name ?? "",
        type: established ? "establishment" : "point",
      },
      lat: place.lat,
      lng: place.lng,
      poi_place: place.place_id
        ? { id: place.place_id, provider: place.provider }
        : undefined,
      source: "autocomplete",
      type: established ? "establishment" : "point",
    },
    type: kind,
  };
}

/** The same place in the flat shape the create-ride endpoint wants. */
export function flat(place: Place) {
  return {
    poi_id: place.place_id,
    poi_provider: place.provider,
    provider: place.provider,
    country: place.country,
    source: "autocomplete",
    city: place.city,
    complete_address: place.full_address ?? place.name ?? "",
    id: 0,
    lat: place.lat,
    lon: place.lng,
    address_lat: place.lat,
    address_lon: place.lng,
    place_id: place.place_id,
    poi: true,
    poi_name: place.name ?? "",
    poi_type: place.type,
    state: place.state,
    title: place.full_address ?? place.name ?? "",
    valid: true,
    country_code: place.country_code,
    address_type: place.type,
  };
}
