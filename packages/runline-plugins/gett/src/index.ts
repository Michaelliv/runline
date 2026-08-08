import type { ActionContext, RunlinePluginAPI } from "runline";
import { randomUUID } from "node:crypto";

/**
 * gett — Gett (taxi, Israel) consumer connector.
 *
 * Reaches the owner's PRIVATE Gett account via the mobile app surface
 * (`b2cgateway.gett.com`). The official Business API is gated on a per-company
 * `order` entitlement, so this rides the same JSON REST surface the phone app uses.
 *
 * Auth: phone + SMS OTP + a card-digits MFA second factor (a trusted device skips
 * the MFA step). A long-lived refresh token then mints short access tokens; both are
 * persisted via `ctx.updateConnection` (rotating). Transport is `Authorization: Bearer`
 * + `x-device-id`; there is no per-request signing. Payment is the account's saved card
 * charged server-side; tracking is REST polling (no websocket).
 *
 * SAFETY: `book_ride`/`cancel_ride` spend money and summon/dismiss a real car. Booking is
 * refused unless the connection sets `allowOrdering: true` AND the caller passes
 * `confirm: true`; without `confirm` it returns a priced PREVIEW + `requiresConfirmation`
 * for a human confirmation gate. Reads (`find_place`, `price`, `ride_status`,
 * `nearby_drivers`, `whoami`) are free.
 *
 * KEEPALIVE: Gett's access token lives only ~15 min and its refresh grant needs a still-valid access
 * token, so the session only survives if refreshed WITHIN that window. On a successful `connect` the
 * status carries a `keepalive` hint; the onboarding agent should create a recurring schedule whose
 * prompt is just `call gett.refresh()` every ~10 min. A single missed window locks the account out
 * and requires an SMS re-login (`connect`).
 */

const HOST = "b2cgateway.gett.com";
const UA = "Gett/android/10.48.187";
const APP_VERSION = "10.48.187";
const DEF_LAT = 32.0779;
const DEF_LON = 34.7743; // Dizengoff Sq, TLV — always has supply

type Cfg = {
  phone?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  deviceId?: string;
  clientDeviceUniqueId?: string;
  deviceGeneratedToken?: string;
  gaid?: string;
  globalUserId?: string | number;
  name?: string;
  creditCardId?: string;
  pendingTempCode?: string;
  defaultLat?: string | number;
  defaultLon?: string | number;
  allowOrdering?: boolean;
};

const cfgOf = (ctx: ActionContext): Cfg => (ctx.connection.config || {}) as Cfg;
const num = (v: unknown, d: number): number => (v == null || v === "" ? d : Number(v));

// ---------- HTTP ----------
async function http(
  ctx: ActionContext,
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<any> {
  const cfg = cfgOf(ctx);
  const { method = "GET", body = null, token = null } = opts;
  const payload = body == null ? null : JSON.stringify(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": UA,
    "app-platform": "android",
    "app-version": APP_VERSION,
    "x-device-id": cfg.deviceId || "",
    "x-client-device-unique-id": cfg.clientDeviceUniqueId || "",
    "x-country-code": "IL",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (payload) headers["content-type"] = "application/json; charset=UTF-8";
  const res = await fetch(`https://${HOST}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = parsed?.error_description || parsed?.message || parsed?.error || text.slice(0, 200);
    throw new Error(`gett ${method} ${path.split("?")[0]} -> ${res.status}: ${detail}`);
  }
  return parsed ?? {};
}

// ---------- device identity (generated once, then persisted) ----------
async function ensureDevice(ctx: ActionContext): Promise<Cfg> {
  const cfg = cfgOf(ctx);
  const patch: Record<string, unknown> = {};
  if (!cfg.deviceId) patch.deviceId = randomUUID();
  if (!cfg.clientDeviceUniqueId) patch.clientDeviceUniqueId = randomUUID();
  if (!cfg.deviceGeneratedToken) patch.deviceGeneratedToken = randomUUID();
  if (!cfg.gaid) patch.gaid = randomUUID();
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  return cfgOf(ctx);
}

// ---------- auth ----------
async function accessToken(ctx: ActionContext, force = false): Promise<string> {
  const cfg = cfgOf(ctx);
  if (!cfg.refreshToken)
    throw new Error(
      "gett: not connected — run connect({ phone }) -> connect({ code }) -> connect({ card }) (owner login)",
    );
  if (!cfg.phone) throw new Error("gett: no phone configured");
  if (!force && cfg.accessToken && cfg.accessTokenExpiresAt && Date.now() < cfg.accessTokenExpiresAt - 60_000)
    return cfg.accessToken;
  // /auth/token renews the access token from the refresh token. The app calls this with its
  // current (still-valid) access token as Bearer and renews proactively; once the access token
  // is fully dead Gett rejects the refresh with a bare 400 and a fresh owner login is required.
  let resp: any;
  try {
    resp = await http(ctx, `/gl/api/v2/phone/${cfg.phone}/auth/token`, {
      method: "POST",
      token: cfg.accessToken || cfg.refreshToken,
      body: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
    });
  } catch (e) {
    if (/-> 400/.test(String((e as Error).message)))
      throw new Error(
        "gett: session expired (refresh rejected) — re-run the owner login: connect({ phone }) -> connect({ code }) -> connect({ card })",
      );
    throw e;
  }
  if (!resp.access_token) throw new Error("gett: token refresh returned no access_token");
  const patch: Record<string, unknown> = {
    accessToken: resp.access_token,
    accessTokenExpiresAt: Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3_600_000),
  };
  if (resp.refresh_token) patch.refreshToken = resp.refresh_token; // rotate
  await ctx.updateConnection(patch);
  return resp.access_token;
}

async function authed(ctx: ActionContext, path: string, opts: { method?: string; body?: unknown } = {}) {
  return http(ctx, path, { ...opts, token: await accessToken(ctx) });
}

// ---------- connect: headless owner login (phone + SMS OTP + card-digits MFA) ----------
async function connectChallenge(ctx: ActionContext, phone?: string) {
  await ensureDevice(ctx);
  let cfg = cfgOf(ctx);
  if (phone) {
    await ctx.updateConnection({ phone: String(phone).replace(/[^0-9]/g, "") });
    cfg = cfgOf(ctx);
  }
  if (!cfg.phone) throw new Error("gett connect: { phone } required (e.g. 972500000000)");
  const body = {
    country_code: "IL",
    country_phone_prefix: 972,
    registration_origin: "organic",
    method: "sms",
    client_device_unique_id: cfg.clientDeviceUniqueId,
    device_tag: "android_ww",
    appsflyer_uid: `${Date.now()}-${Math.floor(Math.random() * 1e18)}`,
    gaid: "",
  };
  const r = await http(ctx, `/gl/api/v2/phone/${cfg.phone}/auth/otp/challenge`, { method: "POST", body });
  return { step: "otp_sent", phone: cfg.phone, code_length: r.confirmation_code_length ?? 6, next: "connect({ code })" };
}

async function connectCode(ctx: ActionContext, code: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.phone) throw new Error("gett connect: no phone — run connect({ phone }) first");
  const r = await http(ctx, `/gl/api/v2/phone/${cfg.phone}/auth/otp/verify`, {
    method: "POST",
    body: { code: String(code) },
  });
  const toks = r.tokens || (r.access_token ? r : null);
  if (toks && toks.refresh_token) {
    await finishTokens(ctx, toks);
    return { step: "connected", note: "no MFA needed", ...(await connectStatus(ctx)) };
  }
  if (!r.mfa_required && r.status !== "mfa_required")
    throw new Error(`gett connect: unexpected otp/verify response: ${JSON.stringify(r).slice(0, 200)}`);
  await ctx.updateConnection({ pendingTempCode: r.temp_code });
  return {
    step: "mfa_required",
    challenge: r.mfa_challenge,
    methods: r.mfa_methods,
    masked_email: r.mfa_masked_email,
    next: r.mfa_methods?.includes("credit_card") ? "connect({ card })" : "connect({ card })",
  };
}

async function connectCard(ctx: ActionContext, digits: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.pendingTempCode) throw new Error("gett connect: no pending MFA — run connect({ code }) first");
  const r = await http(ctx, `/gl/api/v2/phone/${cfg.phone}/auth/mfa/verify`, {
    method: "POST",
    body: { temp_code: cfg.pendingTempCode, card_digits: String(digits) },
  });
  const toks = r.tokens || (r.access_token ? r : null);
  if (!toks || !toks.refresh_token)
    throw new Error(`gett connect: mfa/verify failed: ${r.error || r.status || JSON.stringify(r).slice(0, 200)}`);
  await ctx.updateConnection({ pendingTempCode: undefined });
  await finishTokens(ctx, toks);
  return { step: "connected", ...(await connectStatus(ctx)) };
}

// Store the (IL-scoped) tokens, convert to the GL family the app uses for ongoing refresh, then
// learn identity + the saved card from create_session.
async function finishTokens(ctx: ActionContext, toks: any) {
  await ctx.updateConnection({
    refreshToken: toks.refresh_token,
    accessToken: toks.access_token,
    accessTokenExpiresAt: Date.now() + (toks.expires_in ? toks.expires_in * 1000 : 3_600_000),
  });
  const cfg = cfgOf(ctx);
  // IL -> GL conversion (first /auth/token, Bearer = the fresh access token)
  try {
    const gl = await http(ctx, `/gl/api/v2/phone/${cfg.phone}/auth/token`, {
      method: "POST",
      token: cfg.accessToken,
      body: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
    });
    const patch: Record<string, unknown> = {};
    if (gl.refresh_token) patch.refreshToken = gl.refresh_token;
    if (gl.access_token) {
      patch.accessToken = gl.access_token;
      patch.accessTokenExpiresAt = Date.now() + (gl.expires_in ? gl.expires_in * 1000 : 3_600_000);
    }
    if (Object.keys(patch).length) await ctx.updateConnection(patch);
  } catch {
    /* IL token still works for reads if conversion hiccups */
  }
  try {
    await createSession(ctx, DEF_LAT, DEF_LON);
  } catch {
    /* identity/card discovery is best-effort */
  }
}

// pull the default saved card out of a create_session response
function discoverCard(sessionResp: any): { id: string; last4?: string; type?: string } | null {
  try {
    const list = sessionResp?.payment_methods?.data?.list || [];
    for (const entry of list)
      for (const pm of entry.payment_methods || []) {
        const cards = pm?.additional_data?.credit_card?.cards || [];
        const card = cards.find((c: any) => c.is_default) || cards[0];
        if (card?.card_id) return { id: card.card_id, last4: card.card_number, type: card.card_type };
      }
  } catch {
    /* ignore */
  }
  return null;
}

async function connectStatus(ctx: ActionContext) {
  const cfg = cfgOf(ctx);
  const need: string[] = [];
  if (!cfg.phone) need.push("phone");
  if (!cfg.refreshToken) need.push("refreshToken (login)");
  if (!cfg.creditCardId) need.push("creditCardId (auto-discovered on connect)");
  return {
    connected: !!cfg.refreshToken,
    phone: cfg.phone || null,
    name: cfg.name || null,
    globalUserId: cfg.globalUserId || null,
    creditCard: cfg.creditCardId || null,
    pendingMfa: !!cfg.pendingTempCode,
    missing: need,
    // Onboarding agent: create a keepalive schedule so the session never lapses. Gett's access token
    // lives only ~15 min and its refresh needs a still-valid access token, so the cadence MUST be
    // under 15 min — a single missed window locks the account out and requires an SMS re-login.
    keepalive: cfg.refreshToken ? { every: "10m", prompt: "call gett.refresh()" } : null,
  };
}

// ---------- session bootstrap (identity + card discovery) ----------
async function createSession(ctx: ActionContext, lat: number, lon: number): Promise<any> {
  const cfg = cfgOf(ctx);
  const body = {
    dt: "Android, runline",
    av: APP_VERSION,
    os: "16",
    device_generated_token: cfg.deviceGeneratedToken,
    client_device_unique_id: cfg.clientDeviceUniqueId,
    gcm: 1,
    np: 0,
    lc: "en",
    cc: "IL",
    ai: "com.gettaxi.android",
    lat: num(lat, DEF_LAT),
    lon: num(lon, DEF_LON),
    app_provider: "gettaxi",
    platform: "android",
    gaid: cfg.gaid,
  };
  const r = await authed(ctx, `/gl/rider-facade/phone/${cfg.phone}/create_session`, { method: "POST", body });
  const up = r.user_profile || {};
  const patch: Record<string, unknown> = {};
  if (up.global_user_id && !cfg.globalUserId) patch.globalUserId = up.global_user_id;
  if (up.first_name && !cfg.name) patch.name = up.first_name;
  if (!cfg.creditCardId) {
    const c = discoverCard(r);
    if (c?.id) patch.creditCardId = c.id;
  }
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  return r;
}

function user(ctx: ActionContext) {
  const cfg = cfgOf(ctx);
  return {
    global_id: Number(cfg.globalUserId) || 0,
    name: cfg.name || "",
    phone: cfg.phone,
    vip: { is_vip: false, level: 0 },
  };
}

// ---------- place search: autocomplete -> retrieve ----------
function shapeCandidate(l: any) {
  const loc = l.location || {};
  const poi = loc.poi || {};
  return {
    id: l.id ?? "",
    place_id: l.provider_place_id || poi.id || null,
    provider: (l.provider || poi.provider || "GOOGLE").toUpperCase(),
    name: loc.main_text || poi.name || loc.title || null,
    secondary: loc.secondary_text || null,
    full_address: loc.complete_address || loc.title || loc.main_text || null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    type: loc.type || "point_of_interest",
  };
}

async function findPlace(ctx: ActionContext, query: string, lat: number, lon: number) {
  if (!query) throw new Error("gett find_place: a query is required");
  const body = {
    autocomplete_query: {
      input: String(query),
      locale: "en",
      coordinates: { lat: num(lat, DEF_LAT), lng: num(lon, DEF_LON) },
      providers: [
        { name: "google", limit: 6 },
        { name: "gett", limit: 6 },
      ],
    },
  };
  const r = await authed(ctx, "/gl/locations-proxy/api/v2/locations/autocomplete", { method: "POST", body });
  return (r.locations || []).map(shapeCandidate).filter((c: any) => c.name);
}

async function retrievePlace(ctx: ActionContext, cand: any) {
  const body = {
    locations: [
      {
        id: String(cand.id || ""),
        provider_place_Id: cand.place_id,
        provider: cand.provider,
        locale: "en",
        location: { poi: { provider: cand.provider, name: cand.name } },
      },
    ],
  };
  const r = await authed(ctx, "/gl/locations-proxy/api/v1/locations/retrieve", { method: "POST", body });
  const e = (r.locations || [])[0];
  if (!e) return cand;
  const loc = e.location || {};
  const c = loc.components || {};
  const poi = loc.poi || {};
  return {
    place_id: e.provider_place_id || poi.id || cand.place_id,
    provider: (e.provider || cand.provider).toUpperCase(),
    name: loc.main_text || poi.name || cand.name,
    full_address: loc.complete_address || loc.title || cand.full_address,
    lat: loc.lat ?? cand.lat,
    lng: loc.lng ?? cand.lng,
    type: loc.type || cand.type || "establishment",
    city: c.locality || loc.secondary_text || "",
    state: c.state || "",
    country: c.country || "Israel",
    country_code: c.country_code || "IL",
  };
}

async function resolvePlace(ctx: ActionContext, query: string, lat: number, lon: number) {
  const list = await findPlace(ctx, query, lat, lon);
  if (!list.length) throw new Error(`gett: no place found for "${query}"`);
  const cand = list.find((c: any) => c.provider === "GOOGLE" && c.place_id) || list[0];
  return retrievePlace(ctx, cand);
}

function stopLocation(place: any, kind: "origin" | "destination", ctx: ActionContext) {
  const est = !!place.place_id;
  return {
    actions: [{ type: kind === "origin" ? "pick_up" : "drop_off", user: user(ctx) }],
    location: {
      address: {
        city: place.city || "",
        country: place.country || "Israel",
        full_address: place.full_address || place.name || "",
        poi: !!est,
        poi_name: place.name || "",
        state: place.state || "",
        title: place.full_address || place.name || "",
        type: est ? "establishment" : "point",
      },
      lat: place.lat,
      lng: place.lng,
      poi_place: place.place_id ? { id: place.place_id, provider: place.provider } : undefined,
      source: "autocomplete",
      type: est ? "establishment" : "point",
    },
    type: kind,
  };
}

function flatPlace(place: any) {
  return {
    poi_id: place.place_id,
    poi_provider: place.provider,
    provider: place.provider,
    country: place.country || "Israel",
    source: "autocomplete",
    city: place.city || "",
    complete_address: place.full_address || place.name || "",
    id: 0,
    lat: place.lat,
    lon: place.lng,
    address_lat: place.lat,
    address_lon: place.lng,
    place_id: place.place_id,
    poi: true,
    poi_name: place.name || "",
    poi_type: place.type || "establishment",
    state: place.state || "",
    title: place.full_address || place.name || "",
    valid: true,
    country_code: place.country_code || "IL",
    address_type: place.type || "establishment",
  };
}

// ---------- pricing ----------
async function preorder(ctx: ActionContext, originStop: any, destStop: any) {
  const cfg = cfgOf(ctx);
  const body = {
    stops: [originStop, destStop],
    phone: cfg.phone,
    country_code: "IL",
    category: "transportation",
    payment_type: "credit_card",
    source: "mobile",
  };
  const r = await authed(ctx, "/gl/api/v1/preorder/aggregated", { method: "POST", body });
  const classes = (r.classes_with_prices || []).map((c: any) => {
    const po = (c.price?.pricing_options || [])[0] || {};
    return {
      class_uuid: c.class?.uuid ?? null,
      name: c.class?.name ?? null,
      category: c.class?.category ?? null,
      subcategory: c.class?.subcategory ?? "default",
      estimation_id: po.estimation_id ?? null,
      display_price: po.user_price || po.full_price || null,
      currency: po.currency_iso || null,
      eta: c.class?.display_eta ?? c.class?.eta ?? null,
    };
  });
  const route_id = (r.routes || [])[0]?.uuid ?? null;
  const default_class = r.private_default_class_uuid ?? classes[0]?.class_uuid ?? null;
  return { classes, route_id, default_class };
}

async function planRide(ctx: ActionContext, fromQuery: string, toQuery: string, lat: number, lon: number, classUuid?: string) {
  await createSession(ctx, lat, lon);
  const [from, to] = await Promise.all([resolvePlace(ctx, fromQuery, lat, lon), resolvePlace(ctx, toQuery, lat, lon)]);
  const originStop = stopLocation(from, "origin", ctx);
  const destStop = stopLocation(to, "destination", ctx);
  const pricing = await preorder(ctx, originStop, destStop);
  const chosen = classUuid
    ? pricing.classes.find((c: any) => c.class_uuid === classUuid)
    : pricing.classes.find((c: any) => c.class_uuid === pricing.default_class) || pricing.classes[0];
  if (!chosen) throw new Error("gett: no ride class available for this route");
  return { from, to, originStop, destStop, pricing, chosen };
}

async function bookRide(ctx: ActionContext, plan: any, note?: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.creditCardId) throw new Error("gett: no saved card (creditCardId) — reconnect to auto-discover it");
  const { from, to, originStop, destStop, pricing, chosen } = plan;
  const body = {
    stops: [originStop, destStop],
    division_name: chosen.name || "Taxi",
    route_id: pricing.route_id,
    route_provider: "google",
    ofse_order_flow: false,
    origin: flatPlace(from),
    destination: flatPlace(to),
    note_to_driver: note ? String(note) : "",
    business: 0,
    token: randomUUID(),
    app_provider: "gettaxi",
    user_current_time: Math.floor(Date.now() / 1000),
    credit_card_id: cfg.creditCardId,
    payment_type: "credit_card",
    ordered_from: "Phone",
    division_uuid: chosen.class_uuid,
    category: chosen.category || "transportation",
    subcategory: chosen.subcategory || "default",
    fix_charge_opt_out: true,
    estimation_id: chosen.estimation_id,
    show_class_pricing_info: false,
    timezone_id: "Asia/Jerusalem",
  };
  return authed(ctx, "/il/global-ride-request/api/v1/create", { method: "POST", body });
}

// ---------- plugin ----------
export default function gett(rl: RunlinePluginAPI) {
  rl.setName("gett");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    phone: { type: "string", required: false, description: "Account phone in international digits (e.g. 972500000000).", env: "GETT_PHONE" },
    refreshToken: { type: "string", required: false, description: "Refresh JWT from an owner login; mints access tokens. Set by connect().", env: "GETT_REFRESH_TOKEN" },
    creditCardId: { type: "string", required: false, description: "Saved card id charged for rides. Auto-discovered on connect.", env: "GETT_CREDIT_CARD_ID" },
    deviceId: { type: "string", required: false, description: "x-device-id for the device session (generated if absent).", env: "GETT_DEVICE_ID" },
    clientDeviceUniqueId: { type: "string", required: false, description: "x-client-device-unique-id (generated if absent).", env: "GETT_CLIENT_DEVICE_UNIQUE_ID" },
    defaultLat: { type: "string", required: false, description: "Home latitude for place search when a request carries none (e.g. 32.0779).", env: "GETT_DEFAULT_LAT" },
    defaultLon: { type: "string", required: false, description: "Home longitude for place search (e.g. 34.7743).", env: "GETT_DEFAULT_LON" },
    allowOrdering: { type: "boolean", required: false, default: false, description: "Master switch for booking/cancelling rides. Off = read-only. Even on, book_ride still needs confirm:true." },
  });

  rl.registerAction("connect", {
    access: "write",
    description:
      "Owner login for the Gett account (phone + SMS OTP + card-digits MFA), headless after a one-time relay. Call with { phone } to send the SMS; then { code } with the SMS code; then { card } with the last 4 digits of the saved card. A trusted device skips the card step. { status: true } reports what the session still needs. After this the refresh token drives every read/booking with no further login.",
    inputSchema: {
      phone: { type: "string", required: false, description: "Account phone, international digits. Sends the SMS OTP." },
      code: { type: "string", required: false, description: "The SMS one-time code the owner received." },
      card: { type: "string", required: false, description: "Last 4 digits of the saved card (the MFA second factor)." },
      status: { type: "boolean", required: false, description: "Just report connection status / what's missing." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.status === true) return connectStatus(ctx);
      if (p.card != null && p.card !== "") return connectCard(ctx, String(p.card));
      if (p.code != null && p.code !== "") return connectCode(ctx, String(p.code));
      if (p.phone != null && p.phone !== "") return connectChallenge(ctx, String(p.phone));
      return connectStatus(ctx);
    },
  });

  rl.registerAction("refresh", {
    access: "write",
    description:
      "Keepalive: force a token refresh so the session never lapses. Gett's access token lives only ~15 min and its refresh needs a still-valid access token, so the onboarding agent MUST schedule the one-line prompt 'call gett.refresh()' every ~10 min (a missed window forces an SMS re-login via connect). Returns the new access-token expiry.",
    inputSchema: {},
    async execute(_input, ctx) {
      await accessToken(ctx, true);
      const cfg = cfgOf(ctx);
      return { refreshed: true, access_expires_at: cfg.accessTokenExpiresAt ? new Date(cfg.accessTokenExpiresAt).toISOString() : null };
    },
  });

  rl.registerAction("whoami", {
    access: "read",
    description: "The connected Gett account: user, phone, and any active orders/requests. Confirms the session is authenticated.",
    inputSchema: {},
    async execute(_input, ctx) {
      const r = await createSession(ctx, DEF_LAT, DEF_LON);
      const up = r.user_profile || {};
      return {
        global_user_id: up.global_user_id ?? cfgOf(ctx).globalUserId ?? null,
        name: up.first_name ?? cfgOf(ctx).name ?? null,
        phone: cfgOf(ctx).phone,
        active_orders: (r.active_orders || []).map((o: any) => ({ id: o.id ?? o.order_id, status: o.status })),
        active_requests: (r.active_requests || []).length,
      };
    },
  });

  rl.registerAction("find_place", {
    access: "read",
    description: "Search Gett for a pickup or drop-off place by name ('Dizengoff Square', 'Ben Gurion Airport'). Returns candidates with coordinates and address. Hebrew works. Read-only.",
    inputSchema: {
      query: { type: "string", required: true, description: "Place name or address to search for." },
      lat: { type: "number", required: false, description: "Bias latitude (defaults to the connection's home location)." },
      lon: { type: "number", required: false, description: "Bias longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      return findPlace(ctx, String(p.query), num(p.lat ?? cfg.defaultLat, DEF_LAT), num(p.lon ?? cfg.defaultLon, DEF_LON));
    },
  });

  rl.registerAction("price", {
    access: "read",
    description: "Price a ride between two places by name: every available ride class (Taxi, Priority, …) with its fare and pickup ETA. Read-only — books nothing.",
    inputSchema: {
      from: { type: "string", required: true, description: "Pickup place/address." },
      to: { type: "string", required: true, description: "Destination place/address." },
      lat: { type: "number", required: false, description: "Bias latitude for place search." },
      lon: { type: "number", required: false, description: "Bias longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const plan = await planRide(ctx, String(p.from), String(p.to), num(p.lat ?? cfg.defaultLat, DEF_LAT), num(p.lon ?? cfg.defaultLon, DEF_LON));
      return {
        from: { name: plan.from.name, address: plan.from.full_address },
        to: { name: plan.to.name, address: plan.to.full_address },
        options: plan.pricing.classes.map((c: any) => ({ ride_class: c.name, price: c.display_price, currency: c.currency, eta: c.eta, class_uuid: c.class_uuid })),
      };
    },
  });

  rl.registerAction("nearby_drivers", {
    access: "read",
    description: "Live positions of Gett drivers near a location (for a map or an availability check). Read-only.",
    inputSchema: {
      lat: { type: "number", required: false, description: "Latitude (defaults to home)." },
      lon: { type: "number", required: false, description: "Longitude." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const r = await authed(ctx, `/gl/api/v2/drivers/locations?lat=${num(p.lat ?? cfg.defaultLat, DEF_LAT)}&lng=${num(p.lon ?? cfg.defaultLon, DEF_LON)}`).catch(() => ({}));
      return (r.drivers || []).map((d: any) => ({ id: d.id, status: d.status ?? null, location: (d.last_locations || [])[0] ?? null, route_eta_ts: d.route_eta_ts ?? null }));
    },
  });

  rl.registerAction("ride_status", {
    access: "read",
    description: "Track a booked ride ('where's my taxi?'): status, ETA in seconds, distance, whether it's still cancellable, and driver info once assigned. Needs the order id from book_ride.",
    inputSchema: { order_id: { type: "string", required: true, description: "Order id from book_ride." } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const r = await authed(ctx, `/gl/server/3_3/phone/${cfg.phone}/orders/${p.order_id}`);
      return {
        order_id: r.id ?? p.order_id,
        status: r.status ?? null,
        eta_seconds: r.eta ?? null,
        distance_m: r.distance ?? null,
        cancellable: r.cancellable_by_client ?? null,
        driver_assigned_at: r.driver_assigned_at ?? null,
        payment_type: r.payment_type ?? null,
        driver: r.driver ?? r.driver_details ?? null,
      };
    },
  });

  rl.registerAction("book_ride", {
    access: "write",
    description:
      "Book a REAL Gett taxi — this spends money and summons an actual car to a real person. Call it FIRST without confirm to get a priced preview (pickup, destination, ride class, fare, ETA) and a requiresConfirmation flag; read the fare + pickup back, get an explicit yes, then call again with confirm:true. Requires the connection's allowOrdering. Payment is the account's saved card.",
    inputSchema: {
      from: { type: "string", required: true, description: "Pickup place/address." },
      to: { type: "string", required: true, description: "Destination place/address." },
      class_uuid: { type: "string", required: false, description: "Specific ride class (from price). Defaults to the account's default class." },
      note: { type: "string", required: false, description: "Note to the driver." },
      confirm: { type: "boolean", required: false, description: "Set true ONLY after the person heard the fare + pickup and said yes. Actually books (and pays for) the ride." },
      lat: { type: "number", required: false, description: "Bias latitude for place search." },
      lon: { type: "number", required: false, description: "Bias longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const plan = await planRide(ctx, String(p.from), String(p.to), num(p.lat ?? cfg.defaultLat, DEF_LAT), num(p.lon ?? cfg.defaultLon, DEF_LON), p.class_uuid ? String(p.class_uuid) : undefined);
      const preview = {
        from: { name: plan.from.name, address: plan.from.full_address },
        to: { name: plan.to.name, address: plan.to.full_address },
        ride_class: plan.chosen.name,
        price: plan.chosen.display_price,
        currency: plan.chosen.currency,
        eta_to_pickup: plan.chosen.eta,
        class_uuid: plan.chosen.class_uuid,
      };
      if (p.confirm !== true)
        return { requiresConfirmation: true, action: "book_ride", summary: preview, note: "This books a REAL taxi and charges the saved card. Re-run with confirm:true to book." };
      if (!cfg.allowOrdering) throw new Error("gett book_ride: ordering is disabled for this connection (set allowOrdering:true). Refusing to book.");
      const r = await bookRide(ctx, plan, p.note ? String(p.note) : undefined);
      const orderId = r.order?.id ?? r.order_id ?? null;
      return { ok: r.rc === 0 || r.status === "success", status: "booked", order_id: orderId, summary: preview, track_with: `ride_status(${orderId})` };
    },
  });

  rl.registerAction("cancel_ride", {
    access: "write",
    description: "Cancel a booked Gett ride. Free inside the cancellation window (check ride_status.cancellable); a late cancel may incur a fee. Requires the connection's allowOrdering.",
    inputSchema: {
      order_id: { type: "string", required: true, description: "Order id from book_ride." },
      reason: { type: "number", required: false, description: "Cancellation reason id (optional)." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      if (!cfg.allowOrdering) throw new Error("gett cancel_ride: disabled for this connection (set allowOrdering:true).");
      if (p.reason != null) {
        await authed(ctx, `/gl/server/2_9/phone/${cfg.phone}/orders/${p.order_id}/order_cancellation_reason`, {
          method: "POST",
          body: { cancellation_reason_id: Number(p.reason) },
        }).catch(() => {});
      }
      const r = await authed(ctx, `/gl/server/3_0/phone/${cfg.phone}/orders/${p.order_id}/cancel`, { method: "POST", body: {} });
      return { cancelled: r.rc === 0, order_id: p.order_id, result: r };
    },
  });
}
