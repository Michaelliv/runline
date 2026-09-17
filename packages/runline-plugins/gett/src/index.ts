import { createHash, randomUUID } from "node:crypto";
import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";

/**
 * gett — Gett (taxi, Israel) consumer connector.
 *
 * Reaches the owner's PRIVATE Gett account via the mobile app surface
 * (`b2cgateway.gett.com`). The official Business API is gated on a per-company
 * `order` entitlement, so this rides the same JSON REST surface the phone app uses.
 * Unofficial by nature: it can break or be blocked without notice.
 *
 * Auth: phone + SMS OTP + a card-digits MFA second factor (a trusted device skips
 * the MFA step). A long-lived refresh token then mints short access tokens; both are
 * persisted through `ctx.updateConnection`, which coalesces concurrent renewals.
 * Transport is `Authorization: Bearer` + `x-device-id`; there is no per-request signing.
 * Payment is the account's saved card charged server-side; tracking is REST polling.
 *
 * REFRESH: the session is long-lived and unattended — no keepalive schedule is needed.
 * The GL refresh token lasts ~90 days and the refresh grant does NOT require a live
 * access token (Gett accepts a bearer expired by days). Every `/auth/token` call MUST
 * carry the `?lc=en` query param — without it the server returns a bare 400 (empty
 * body); that missing param, not the ~15-min access-token TTL, was the real lockout
 * (proven end-to-end 2026-08-11). A genuine 400 means the refresh token itself is dead.
 *
 * SAFETY: `book_ride` spends money and summons a real car to a real person, so consent
 * is bound to a price, not just to an intent. A call without `confirm` returns a priced
 * preview and a `quote` that fingerprints the route, class, and fare. Booking requires
 * `allowOrdering` on the connection, `confirm: true`, AND that same quote still pricing
 * identically — if the fare moved between the preview and the confirmation, nothing is
 * booked and the new price comes back for a fresh human decision.
 */

const HOST = "b2cgateway.gett.com";
const UA = "Gett/android/10.48.187";
const APP_VERSION = "10.48.187";
const DEF_LAT = 32.0779;
const DEF_LON = 34.7743; // Dizengoff Sq, TLV — always has supply
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Renew this long before expiry so an in-flight request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

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

// biome-ignore lint/suspicious/noExplicitAny: provider JSON is unshaped and undocumented
type Json = any;

const cfgOf = (ctx: ActionContext): Cfg => (ctx.connection.config || {}) as Cfg;
const num = (v: unknown, d: number): number =>
  v == null || v === "" ? d : Number(v);

/**
 * Normalize a phone to Gett's expected international digits (E.164 without '+'),
 * so a number spoken/typed the local Israeli way still routes the SMS. Gett pairs
 * the path number with country_phone_prefix:972, so a national "0500000000" (or
 * "050-000-0000") must become "972500000000" — otherwise the challenge returns
 * success but the SMS is silently dropped. Idempotent; leaves a valid intl number.
 */
function normPhone(p: string): string {
  let d = String(p).replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2); // 00 = intl exit code
  if (d.startsWith("972")) return d; // already international
  if (d.startsWith("0")) return `972${d.slice(1)}`; // national 0XXXXXXXXX
  return `972${d}`; // bare local, no leading 0 (e.g. 500000000)
}

/**
 * One path segment, escaped. Caller-supplied ids reach the URL carrying a bearer
 * token, so a segment that could climb out of its position is refused outright
 * rather than encoded and hoped about.
 */
function seg(value: unknown, what: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "." || raw === ".." || /[/\\?#]/.test(raw)) {
    throw new Error(`gett: invalid ${what}`);
  }
  return encodeURIComponent(raw);
}

// ---------- HTTP ----------

/** Carries the status for control flow without putting a provider body in the message. */
class GettError extends Error {
  readonly status: number;
  constructor(status: number, endpoint: string) {
    super(`gett: request failed (HTTP ${status}) on ${endpoint}`);
    this.name = "GettError";
    this.status = status;
  }
}

/** The account's phone is in nearly every path; it never belongs in an error. */
function endpointOf(path: string): string {
  return path.split("?")[0].replace(/\/phone\/[^/]+/, "/phone/{phone}");
}

async function bodyText(res: Response, endpoint: string): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`gett: response exceeded the size limit on ${endpoint}`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function http(
  ctx: ActionContext,
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Json> {
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
  const endpoint = endpointOf(path);
  // A redirect would carry the bearer to whatever host the response names.
  const res = await fetch(`https://${HOST}${path}`, {
    method,
    headers,
    body: payload,
    redirect: "error",
  });
  const text = await bodyText(res, endpoint);
  let parsed: Json = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  // The body can hold tokens, the OTP, or the account holder's details; the status
  // and the redacted endpoint are what a caller can act on.
  if (!res.ok) throw new GettError(res.status, endpoint);
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

function fresh(cfg: Cfg): boolean {
  return Boolean(
    cfg.accessToken &&
      cfg.accessTokenExpiresAt &&
      Date.now() < cfg.accessTokenExpiresAt - EXPIRY_SKEW_MS,
  );
}

function expiresAt(expiresIn: unknown): number {
  return Date.now() + (expiresIn ? Number(expiresIn) * 1000 : 3_600_000);
}

/**
 * The refresh grant itself. Called only from inside an update owner, and always
 * with an explicit token, so it can never re-enter the connection store.
 */
async function refreshGrant(ctx: ActionContext, cfg: Cfg): Promise<Json> {
  try {
    return await http(
      ctx,
      `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/token?lc=en`,
      {
        method: "POST",
        token: cfg.accessToken || cfg.refreshToken,
        body: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
      },
    );
  } catch (e) {
    if (e instanceof GettError && e.status === 400) {
      throw new Error(
        "gett: session expired (refresh rejected) — re-run the owner login: connect({ phone }) -> connect({ code }) -> connect({ card })",
      );
    }
    throw e;
  }
}

async function accessToken(ctx: ActionContext, force = false): Promise<string> {
  const cfg = cfgOf(ctx);
  if (!cfg.refreshToken)
    throw new Error(
      "gett: not connected — run connect({ phone }) -> connect({ code }) -> connect({ card }) (owner login)",
    );
  if (!cfg.phone) throw new Error("gett: no phone configured");
  if (!force && fresh(cfg)) return cfg.accessToken as string;

  let token: string | undefined;
  // Renewal runs under the store's ownership so parallel actions coalesce onto
  // one grant instead of racing and clobbering each other's rotated token.
  await ctx.updateConnection(async (current) => {
    const owned = current as Cfg;
    if (!force && fresh(owned)) {
      token = owned.accessToken;
      return undefined;
    }
    const resp = await refreshGrant(ctx, owned);
    if (!resp.access_token)
      throw new Error("gett: token refresh returned no access_token");
    token = String(resp.access_token);
    return {
      accessToken: resp.access_token,
      accessTokenExpiresAt: expiresAt(resp.expires_in),
      ...(resp.refresh_token ? { refreshToken: resp.refresh_token } : {}),
    };
  });
  if (!token) throw new Error("gett: token refresh produced no access token");
  return token;
}

async function authed(
  ctx: ActionContext,
  path: string,
  opts: { method?: string; body?: unknown } = {},
) {
  return http(ctx, path, { ...opts, token: await accessToken(ctx) });
}

// ---------- connect: headless owner login (phone + SMS OTP + card-digits MFA) ----------
async function connectChallenge(ctx: ActionContext, phone?: string) {
  await ensureDevice(ctx);
  let cfg = cfgOf(ctx);
  if (phone) {
    await ctx.updateConnection({ phone: normPhone(String(phone)) });
    cfg = cfgOf(ctx);
  }
  if (!cfg.phone)
    throw new Error("gett connect: { phone } required (e.g. 972500000000)");
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
  const r = await http(
    ctx,
    `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/otp/challenge`,
    { method: "POST", body },
  );
  // Gett answers 200 even when it refuses to send (rate-limit/block); the verdict is in
  // the body's rc/status, not the HTTP code. Success is rc:0 / status:"success". Surface a
  // block instead of falsely reporting the SMS went out, so the caller waits rather than
  // asking for a code that never arrives.
  if ((r.rc != null && r.rc !== 0) || (r.status && r.status !== "success")) {
    const mins = r.blocked_until != null ? Number(r.blocked_until) : null;
    return {
      step: r.status === "blocked" ? "blocked" : "error",
      phone: cfg.phone,
      status: r.status ?? null,
      rc: r.rc ?? null,
      retry_after_minutes: mins,
      error: "Gett refused the OTP challenge and did NOT send an SMS.",
      note:
        r.status === "blocked"
          ? `Too many attempts — Gett blocked new codes${mins != null ? ` for ~${mins} min` : ""}. Wait, then run connect({ phone }) again.`
          : "No SMS was sent. Check the phone digits, then retry connect({ phone }).",
    };
  }
  return {
    step: "otp_sent",
    phone: cfg.phone,
    code_length: r.confirmation_code_length ?? 6,
    next: "connect({ code })",
  };
}

async function connectCode(ctx: ActionContext, code: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.phone)
    throw new Error("gett connect: no phone — run connect({ phone }) first");
  const r = await http(
    ctx,
    `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/otp/verify`,
    { method: "POST", body: { code: String(code) } },
  );
  const toks = r.tokens || (r.access_token ? r : null);
  if (toks?.refresh_token) {
    await finishTokens(ctx, toks);
    return {
      step: "connected",
      note: "no MFA needed",
      ...(await connectStatus(ctx)),
    };
  }
  // The body of an auth response can carry tokens; report its shape, never its contents.
  if (!r.mfa_required && r.status !== "mfa_required")
    throw new Error(
      `gett connect: otp/verify returned neither tokens nor an MFA challenge (fields: ${Object.keys(r).sort().join(", ") || "none"})`,
    );
  await ctx.updateConnection({ pendingTempCode: r.temp_code });
  return {
    step: "mfa_required",
    challenge: r.mfa_challenge,
    methods: r.mfa_methods,
    masked_email: r.mfa_masked_email,
    next: "connect({ card })",
  };
}

async function connectCard(ctx: ActionContext, digits: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.pendingTempCode)
    throw new Error(
      "gett connect: no pending MFA — run connect({ code }) first",
    );
  const r = await http(
    ctx,
    `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/mfa/verify`,
    {
      method: "POST",
      body: { temp_code: cfg.pendingTempCode, card_digits: String(digits) },
    },
  );
  const toks = r.tokens || (r.access_token ? r : null);
  if (!toks?.refresh_token)
    throw new Error(
      `gett connect: mfa/verify did not return tokens${r.status ? ` (status: ${String(r.status)})` : ""} — check the card digits and retry`,
    );
  await ctx.updateConnection({ pendingTempCode: undefined });
  await finishTokens(ctx, toks);
  return { step: "connected", ...(await connectStatus(ctx)) };
}

/**
 * Store the (IL-scoped) tokens, convert to the GL family the app uses for ongoing
 * refresh, then learn identity + the saved card from create_session.
 */
async function finishTokens(ctx: ActionContext, toks: Json) {
  await ctx.updateConnection({
    refreshToken: toks.refresh_token,
    accessToken: toks.access_token,
    accessTokenExpiresAt: expiresAt(toks.expires_in),
  });
  const cfg = cfgOf(ctx);
  // IL -> GL conversion (first /auth/token, Bearer = the fresh access token). `?lc=en` is
  // REQUIRED here too — without the query param the conversion 400s even with a valid IL bearer.
  try {
    const gl = await http(
      ctx,
      `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/token?lc=en`,
      {
        method: "POST",
        token: cfg.accessToken,
        body: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
      },
    );
    const patch: Record<string, unknown> = {};
    if (gl.refresh_token) patch.refreshToken = gl.refresh_token;
    if (gl.access_token) {
      patch.accessToken = gl.access_token;
      patch.accessTokenExpiresAt = expiresAt(gl.expires_in);
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

/** Pull the default saved card out of a create_session response. */
function discoverCard(
  sessionResp: Json,
): { id: string; last4?: string; type?: string } | null {
  try {
    const list = sessionResp?.payment_methods?.data?.list || [];
    for (const entry of list)
      for (const pm of entry.payment_methods || []) {
        const cards = pm?.additional_data?.credit_card?.cards || [];
        const card = cards.find((c: Json) => c.is_default) || cards[0];
        if (card?.card_id)
          return {
            id: card.card_id,
            last4: card.card_number,
            type: card.card_type,
          };
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
    orderingEnabled: cfg.allowOrdering === true,
    missing: need,
    // No keepalive schedule is needed: the GL refresh token is long-lived (~90d) and the
    // refresh grant doesn't need a live access token, so a stored session survives unattended.
    keepalive: null,
  };
}

// ---------- session bootstrap (identity + card discovery) ----------
async function createSession(
  ctx: ActionContext,
  lat: number,
  lon: number,
): Promise<Json> {
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
  const r = await authed(
    ctx,
    `/gl/rider-facade/phone/${seg(cfg.phone, "phone")}/create_session`,
    { method: "POST", body },
  );
  const up = r.user_profile || {};
  const patch: Record<string, unknown> = {};
  if (up.global_user_id && !cfg.globalUserId)
    patch.globalUserId = up.global_user_id;
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
function shapeCandidate(l: Json) {
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

async function findPlace(
  ctx: ActionContext,
  query: string,
  lat: number,
  lon: number,
) {
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
  const r = await authed(
    ctx,
    "/gl/locations-proxy/api/v2/locations/autocomplete",
    { method: "POST", body },
  );
  return (r.locations || []).map(shapeCandidate).filter((c: Json) => c.name);
}

async function retrievePlace(ctx: ActionContext, cand: Json) {
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
  const r = await authed(ctx, "/gl/locations-proxy/api/v1/locations/retrieve", {
    method: "POST",
    body,
  });
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

async function resolvePlace(
  ctx: ActionContext,
  query: string,
  lat: number,
  lon: number,
) {
  const list = await findPlace(ctx, query, lat, lon);
  if (!list.length) throw new Error(`gett: no place found for "${query}"`);
  const cand =
    list.find((c: Json) => c.provider === "GOOGLE" && c.place_id) || list[0];
  return retrievePlace(ctx, cand);
}

function stopLocation(
  place: Json,
  kind: "origin" | "destination",
  ctx: ActionContext,
) {
  const est = !!place.place_id;
  return {
    actions: [
      { type: kind === "origin" ? "pick_up" : "drop_off", user: user(ctx) },
    ],
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
      poi_place: place.place_id
        ? { id: place.place_id, provider: place.provider }
        : undefined,
      source: "autocomplete",
      type: est ? "establishment" : "point",
    },
    type: kind,
  };
}

function flatPlace(place: Json) {
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
async function preorder(ctx: ActionContext, originStop: Json, destStop: Json) {
  const cfg = cfgOf(ctx);
  const body = {
    stops: [originStop, destStop],
    phone: cfg.phone,
    country_code: "IL",
    category: "transportation",
    payment_type: "credit_card",
    source: "mobile",
  };
  const r = await authed(ctx, "/gl/api/v1/preorder/aggregated", {
    method: "POST",
    body,
  });
  const classes = (r.classes_with_prices || []).map((c: Json) => {
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
  const default_class =
    r.private_default_class_uuid ?? classes[0]?.class_uuid ?? null;
  return { classes, route_id, default_class };
}

async function planRide(
  ctx: ActionContext,
  fromQuery: string,
  toQuery: string,
  lat: number,
  lon: number,
  classUuid?: string,
) {
  await createSession(ctx, lat, lon);
  const [from, to] = await Promise.all([
    resolvePlace(ctx, fromQuery, lat, lon),
    resolvePlace(ctx, toQuery, lat, lon),
  ]);
  const originStop = stopLocation(from, "origin", ctx);
  const destStop = stopLocation(to, "destination", ctx);
  const pricing = await preorder(ctx, originStop, destStop);
  const chosen = classUuid
    ? pricing.classes.find((c: Json) => c.class_uuid === classUuid)
    : pricing.classes.find(
        (c: Json) => c.class_uuid === pricing.default_class,
      ) || pricing.classes[0];
  if (!chosen) throw new Error("gett: no ride class available for this route");
  return { from, to, originStop, destStop, pricing, chosen };
}

type Plan = Awaited<ReturnType<typeof planRide>>;

/**
 * A fingerprint of everything a person agrees to when they say yes: both endpoints,
 * the ride class, and the fare. Re-derived on the confirming call, so a fare that
 * moved in between cannot be booked against the old consent.
 */
function quoteFor(plan: Plan): string {
  const material = JSON.stringify([
    plan.from.place_id ?? plan.from.name ?? "",
    plan.to.place_id ?? plan.to.name ?? "",
    plan.chosen.class_uuid ?? "",
    plan.chosen.display_price ?? "",
    plan.chosen.currency ?? "",
  ]);
  return `q_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

function previewOf(plan: Plan) {
  return {
    from: { name: plan.from.name, address: plan.from.full_address },
    to: { name: plan.to.name, address: plan.to.full_address },
    ride_class: plan.chosen.name,
    price: plan.chosen.display_price,
    currency: plan.chosen.currency,
    eta_to_pickup: plan.chosen.eta,
    class_uuid: plan.chosen.class_uuid,
  };
}

async function bookRide(ctx: ActionContext, plan: Plan, note?: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.creditCardId)
    throw new Error(
      "gett: no saved card (creditCardId) — reconnect to auto-discover it",
    );
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
  return authed(ctx, "/il/global-ride-request/api/v1/create", {
    method: "POST",
    body,
  });
}

// ---------- schemas ----------
const STRICT = { additionalProperties: false } as const;

const latSchema = t.Number({
  minimum: -90,
  maximum: 90,
  description:
    "Bias latitude for place search (defaults to the connection's home location).",
});
const lonSchema = t.Number({
  minimum: -180,
  maximum: 180,
  description: "Bias longitude for place search.",
});
const placeSchema = (what: string) =>
  t.String({ minLength: 1, maxLength: 300, description: what });
const orderIdSchema = t.String({
  minLength: 1,
  maxLength: 128,
  description: "Order id from book_ride.",
});

// ---------- plugin ----------
export default function gett(rl: RunlinePluginAPI) {
  rl.setName("gett");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      phone: t.Optional(
        t.String({
          env: "GETT_PHONE",
          description:
            "Account phone; international or local Israeli digits both work (e.g. 972500000000, 0500000000, or 050-000-0000 — all normalized to 972…).",
        }),
      ),
      refreshToken: t.Optional(
        t.String({
          env: "GETT_REFRESH_TOKEN",
          description:
            "Refresh JWT from an owner login; mints access tokens. Set by connect(). Store only in secrets.",
        }),
      ),
      creditCardId: t.Optional(
        t.String({
          env: "GETT_CREDIT_CARD_ID",
          description:
            "Saved card id charged for rides. Auto-discovered on connect.",
        }),
      ),
      deviceId: t.Optional(
        t.String({
          env: "GETT_DEVICE_ID",
          description:
            "x-device-id for the device session (generated if absent).",
        }),
      ),
      clientDeviceUniqueId: t.Optional(
        t.String({
          env: "GETT_CLIENT_DEVICE_UNIQUE_ID",
          description: "x-client-device-unique-id (generated if absent).",
        }),
      ),
      defaultLat: t.Optional(
        t.String({
          env: "GETT_DEFAULT_LAT",
          description:
            "Home latitude for place search when a request carries none (e.g. 32.0779).",
        }),
      ),
      defaultLon: t.Optional(
        t.String({
          env: "GETT_DEFAULT_LON",
          description: "Home longitude for place search (e.g. 34.7743).",
        }),
      ),
      allowOrdering: t.Optional(
        t.Boolean({
          default: false,
          description:
            "Master switch for booking/cancelling rides. Off = read-only. Even on, book_ride still needs confirm:true and a matching quote.",
        }),
      ),
    }),
  );

  rl.registerAction("connect", {
    access: "write",
    description:
      "Owner login for the Gett account (phone + SMS OTP + card-digits MFA), headless after a one-time relay. Call with { phone } to send the SMS; then { code } with the SMS code; then { card } with the last 4 digits of the saved card. A trusted device skips the card step. { status: true } reports what the session still needs. After this the refresh token drives every read/booking with no further login.",
    inputSchema: t.Object(
      {
        phone: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 32,
            description:
              "Account phone; international or local Israeli digits both work (972500000000 / 0500000000 / 050-000-0000). Sends the SMS OTP.",
          }),
        ),
        code: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 12,
            description: "The SMS one-time code the owner received.",
          }),
        ),
        card: t.Optional(
          t.String({
            minLength: 2,
            maxLength: 8,
            description:
              "Last 4 digits of the saved card (the MFA second factor).",
          }),
        ),
        status: t.Optional(
          t.Boolean({
            description: "Just report connection status / what's missing.",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.status === true) return connectStatus(ctx);
      if (p.card != null && p.card !== "")
        return connectCard(ctx, String(p.card));
      if (p.code != null && p.code !== "")
        return connectCode(ctx, String(p.code));
      if (p.phone != null && p.phone !== "")
        return connectChallenge(ctx, String(p.phone));
      return connectStatus(ctx);
    },
  });

  rl.registerAction("refresh", {
    access: "write",
    description:
      "Mint a fresh access token on demand from the stored refresh token. NOT time-critical and NO keepalive schedule is needed — the refresh token is long-lived (~90 days) and survives unattended, so a session stays valid indefinitely after connect. Returns the new access-token expiry.",
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

  rl.registerAction("whoami", {
    access: "read",
    description:
      "The connected Gett account: user, phone, and any active orders/requests. Confirms the session is authenticated.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      const r = await createSession(ctx, DEF_LAT, DEF_LON);
      const up = r.user_profile || {};
      return {
        global_user_id: up.global_user_id ?? cfgOf(ctx).globalUserId ?? null,
        name: up.first_name ?? cfgOf(ctx).name ?? null,
        phone: cfgOf(ctx).phone,
        active_orders: (r.active_orders || []).map((o: Json) => ({
          id: o.id ?? o.order_id,
          status: o.status,
        })),
        active_requests: (r.active_requests || []).length,
      };
    },
  });

  rl.registerAction("find_place", {
    access: "read",
    description:
      "Search Gett for a pickup or drop-off place by name ('Dizengoff Square', 'Ben Gurion Airport'). Returns candidates with coordinates and address. Hebrew works. Read-only.",
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
      const cfg = cfgOf(ctx);
      return findPlace(
        ctx,
        String(p.query),
        num(p.lat ?? cfg.defaultLat, DEF_LAT),
        num(p.lon ?? cfg.defaultLon, DEF_LON),
      );
    },
  });

  rl.registerAction("price", {
    access: "read",
    description:
      "Price a ride between two places by name: every available ride class (Taxi, Priority, …) with its fare and pickup ETA. Read-only — books nothing.",
    inputSchema: t.Object(
      {
        from: placeSchema("Pickup place/address."),
        to: placeSchema("Destination place/address."),
        lat: t.Optional(latSchema),
        lon: t.Optional(lonSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const plan = await planRide(
        ctx,
        String(p.from),
        String(p.to),
        num(p.lat ?? cfg.defaultLat, DEF_LAT),
        num(p.lon ?? cfg.defaultLon, DEF_LON),
      );
      return {
        from: { name: plan.from.name, address: plan.from.full_address },
        to: { name: plan.to.name, address: plan.to.full_address },
        options: plan.pricing.classes.map((c: Json) => ({
          ride_class: c.name,
          price: c.display_price,
          currency: c.currency,
          eta: c.eta,
          class_uuid: c.class_uuid,
        })),
      };
    },
  });

  rl.registerAction("nearby_drivers", {
    access: "read",
    description:
      "Live positions of Gett drivers near a location (for a map or an availability check). Read-only.",
    inputSchema: t.Object(
      { lat: t.Optional(latSchema), lon: t.Optional(lonSchema) },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const query = new URLSearchParams({
        lat: String(num(p.lat ?? cfg.defaultLat, DEF_LAT)),
        lng: String(num(p.lon ?? cfg.defaultLon, DEF_LON)),
      });
      const r = await authed(ctx, `/gl/api/v2/drivers/locations?${query}`);
      return (r.drivers || []).map((d: Json) => ({
        id: d.id,
        status: d.status ?? null,
        location: (d.last_locations || [])[0] ?? null,
        route_eta_ts: d.route_eta_ts ?? null,
      }));
    },
  });

  rl.registerAction("ride_status", {
    access: "read",
    description:
      "Track a booked ride ('where's my taxi?'): status, ETA in seconds, distance, whether it's still cancellable, and driver info once assigned. Needs the order id from book_ride.",
    inputSchema: t.Object({ order_id: orderIdSchema }, STRICT),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      const r = await authed(
        ctx,
        `/gl/server/3_3/phone/${seg(cfg.phone, "phone")}/orders/${seg(p.order_id, "order_id")}`,
      );
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
      "Book a REAL Gett taxi — this spends money and summons an actual car to a real person. Call it FIRST without confirm to get a priced preview (pickup, destination, ride class, fare, ETA) plus a `quote`; read the fare and pickup back, get an explicit yes, then call again with confirm:true AND that quote. If the fare moved in between, nothing is booked and the new price comes back instead. Requires the connection's allowOrdering. Payment is the account's saved card.",
    inputSchema: t.Object(
      {
        from: placeSchema("Pickup place/address."),
        to: placeSchema("Destination place/address."),
        class_uuid: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 128,
            description:
              "Specific ride class (from price). Defaults to the account's default class.",
          }),
        ),
        note: t.Optional(
          t.String({ maxLength: 500, description: "Note to the driver." }),
        ),
        confirm: t.Optional(
          t.Boolean({
            description:
              "Set true ONLY after the person heard the fare + pickup and said yes. Must be sent with the quote from the preview call. Actually books (and pays for) the ride.",
          }),
        ),
        quote: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 64,
            description:
              "The quote returned by the preview call. Binds this booking to the exact fare the person approved; a changed fare refuses rather than books.",
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
      const plan = await planRide(
        ctx,
        String(p.from),
        String(p.to),
        num(p.lat ?? cfg.defaultLat, DEF_LAT),
        num(p.lon ?? cfg.defaultLon, DEF_LON),
        p.class_uuid ? String(p.class_uuid) : undefined,
      );
      const quote = quoteFor(plan);
      const summary = previewOf(plan);

      if (p.confirm !== true) {
        return {
          requiresConfirmation: true,
          action: "book_ride",
          quote,
          summary,
          note: cfg.allowOrdering
            ? "This books a REAL taxi and charges the saved card. Read the fare and pickup back to the person, then re-run with confirm:true and this quote."
            : "Ordering is disabled for this connection (allowOrdering is false), so this preview cannot be booked. Enable allowOrdering first.",
        };
      }
      if (!cfg.allowOrdering)
        throw new Error(
          "gett book_ride: ordering is disabled for this connection (set allowOrdering:true). Refusing to book.",
        );
      if (p.quote !== quote) {
        return {
          booked: false,
          reason: p.quote ? "price_changed" : "quote_required",
          quote,
          summary,
          note: p.quote
            ? "The fare or ride class changed since the quote that was approved, so nothing was booked. Read the new fare back and confirm again with the new quote."
            : "confirm:true must carry the quote from the preview call, so a person can only approve a fare they were actually shown. Nothing was booked.",
        };
      }
      const r = await bookRide(ctx, plan, p.note ? String(p.note) : undefined);
      const orderId = r.order?.id ?? r.order_id ?? null;
      return {
        ok: r.rc === 0 || r.status === "success",
        status: "booked",
        order_id: orderId,
        summary,
        track_with: `ride_status(${orderId})`,
      };
    },
  });

  rl.registerAction("cancel_ride", {
    access: "write",
    description:
      "Cancel a booked Gett ride. Free inside the cancellation window (check ride_status.cancellable); a late cancel may incur a fee. Requires the connection's allowOrdering.",
    inputSchema: t.Object(
      {
        order_id: orderIdSchema,
        reason: t.Optional(
          t.Integer({
            minimum: 0,
            description: "Cancellation reason id (optional).",
          }),
        ),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const cfg = cfgOf(ctx);
      if (!cfg.allowOrdering)
        throw new Error(
          "gett cancel_ride: disabled for this connection (set allowOrdering:true).",
        );
      const phone = seg(cfg.phone, "phone");
      const order = seg(p.order_id, "order_id");
      // The reason is optional metadata; a rejection there must not block the cancel,
      // but the caller is told whether it landed rather than left to assume.
      let reasonRecorded: boolean | null = null;
      if (p.reason != null) {
        reasonRecorded = await authed(
          ctx,
          `/gl/server/2_9/phone/${phone}/orders/${order}/order_cancellation_reason`,
          {
            method: "POST",
            body: { cancellation_reason_id: Number(p.reason) },
          },
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
        order_id: p.order_id,
        reason_recorded: reasonRecorded,
        result: r,
      };
    },
  });
}
