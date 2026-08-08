import type { ActionContext, RunlinePluginAPI } from "runline";
import { randomUUID } from "node:crypto";

/**
 * wolt — Wolt (food/grocery delivery, Israel + global) consumer connector.
 *
 * Reads (search / venue / menu / estimate) are ANONYMOUS against Wolt's public JSON surface.
 * Ordering is authenticated and GATED: `order_create` returns a priced preview + requiresConfirmation,
 * and only places a real, paid order when the connection sets `allowOrdering: true` AND the caller
 * passes `confirm: true`. Payment is the account's saved card (Google Pay is not replayable headless).
 *
 * Onboarding (`connect`) is headless and covers every Wolt account type: email code, email magic link,
 * and the phone-merge path that reaches Google/social/phone-only accounts. Every login email/SMS send
 * is fronted by a passive hCaptcha token (`captcha`), minted in a real browser on a wolt.com origin.
 *
 * Session (refresh token, rotating) + device ids + saved-card id are persisted via `ctx.updateConnection`.
 * Prices are integer MINOR UNITS (agorot in ISR): 1800 === ₪18.00. Single-tenant: one account per connection.
 *
 * KEEPALIVE: on a successful `connect` the result carries a `keepalive` hint. The onboarding agent should
 * create a recurring schedule whose prompt is just `call wolt.refresh()` (every ~12h) so the rotating
 * refresh token never lapses. Wolt's refresh needs no live access token, so a slow cadence is enough.
 */

const R = "restaurant-api.wolt.com";
const C = "consumer-api.wolt.com";
const AUTH = "authentication.wolt.com";
const DEF_LAT = 32.0853;
const DEF_LON = 34.7818; // TLV
const AUDIENCE = "restaurant-api";
const CAPABILITIES = "access_confirmation";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// mobile client headers — must match the captured app so the API accepts the authed calls.
const MOBILE: Record<string, string> = {
  "app-language": "en",
  "app-locale": "en-US",
  "client-version": "26.30.4",
  clientversionnumber: "142026304",
  platform: "Android",
  "user-agent": "Wolt/26.30.4; Build/142026304; Android/16; Google sdk_gphone",
};

type Cfg = {
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  deviceToken?: string;
  visitorId?: string;
  woltSessionId?: string;
  ravelinDeviceId?: string;
  paymentMethodId?: string;
  pendingPhone?: string;
  pendingEmail?: string;
  pendingEmailToken?: string;
  pendingOperationToken?: string;
  pendingConfirmationToken?: string;
  defaultLat?: string | number;
  defaultLon?: string | number;
  allowOrdering?: boolean;
};

const cfgOf = (ctx: ActionContext): Cfg => (ctx.connection.config || {}) as Cfg;
const num = (v: unknown, d: number): number => (v == null || v === "" ? d : Number(v));

class WoltError extends Error {
  status?: number;
  body?: string;
}

// web=true → anonymous read headers (impersonate the wolt.com web app). web=false → bare/mobile.
async function http(
  host: string,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; web?: boolean } = {},
): Promise<any> {
  const { method = "GET", body = null, headers = {}, raw = false, web = true } = opts;
  const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
  const base: Record<string, string> = web
    ? {
        "user-agent": UA,
        accept: raw ? "text/html,application/xhtml+xml" : "application/json",
        "accept-language": "en",
        "app-language": "en",
        platform: "Web",
        "client-version": "1.16.125",
        origin: "https://wolt.com",
        referer: "https://wolt.com/",
      }
    : { accept: "application/json" };
  const h: Record<string, string> = { ...base, ...headers };
  if (payload && !h["content-type"]) h["content-type"] = "application/json";
  const res = await fetch(`https://${host}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  if (res.status >= 400) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).msg || msg;
    } catch {
      /* keep raw */
    }
    const hint = res.status === 410 ? " (endpoint retired by Wolt)" : "";
    const err = new WoltError(`wolt ${method} ${host}${path.split("?")[0]} -> ${res.status}${hint}: ${msg}`);
    // Wolt returns MEANINGFUL data in 4xx bodies (e.g. the login escalation token) — keep it.
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (raw) return text;
  if (!text.trim()) throw new WoltError(`wolt ${method} ${host}${path.split("?")[0]} -> 200 EMPTY BODY (retired endpoint)`);
  try {
    return JSON.parse(text);
  } catch {
    throw new WoltError("wolt: non-JSON response");
  }
}

const formEncode = (o: Record<string, unknown>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent((v ?? "") as string)}`)
    .join("&");

// ---------- assortment (the menu — anonymous) ----------
async function assortment(slug: string, lang = "en") {
  return http(C, `/consumer-api/consumer-assortment/v1/venues/slug/${encodeURIComponent(slug)}/assortment?language=${lang}`);
}

// ---------- reads (anonymous) ----------
function collectVenues(data: any) {
  const out: any[] = [];
  for (const s of data.sections || [])
    for (const it of s.items || []) {
      const v = it.venue;
      if (!v) continue;
      out.push({
        id: v.id,
        slug: v.slug,
        name: v.name,
        address: v.address,
        city: v.city || null,
        online: v.online,
        currency: v.currency,
        country: v.country,
        rating: v.rating?.score ?? null,
        rating_volume: v.rating?.volume ?? null,
        price_range: v.price_range ?? null,
        estimate_minutes: v.estimate ?? null,
        estimate_range: v.estimate_range ?? null,
        delivery_price: v.delivery_price_int ?? null,
        tags: v.tags || [],
        categories: (v.categories || []).map((c: any) => c.name),
        short_description: v.short_description || null,
        location: v.location?.coordinates ?? null,
      });
    }
  return out;
}

async function cmdSearch(q: string, lat: number, lon: number, limit: number) {
  const data = await http(R, "/v1/pages/search", { method: "POST", body: { q, target: "venues", lat, lon } });
  const venues = collectVenues(data).slice(0, limit);
  return { query: q, count: venues.length, venues };
}

async function cmdNearby(lat: number, lon: number, limit: number, openOnly: boolean) {
  const data = await http(R, `/v1/pages/restaurants?lat=${lat}&lon=${lon}`);
  let venues = collectVenues(data);
  if (openOnly) venues = venues.filter((v) => v.online);
  return { city: data.city, total: venues.length, venues: venues.slice(0, limit) };
}

async function cmdVenue(slug: string, lat: number, lon: number) {
  const [stat, dyn] = await Promise.all([
    http(C, `/order-xp/web/v1/pages/venue/slug/${encodeURIComponent(slug)}/static?lat=${lat}&lon=${lon}`),
    http(C, `/order-xp/web/v1/venue/slug/${encodeURIComponent(slug)}/dynamic/?selected_delivery_method=homedelivery`).catch(() => null),
  ]);
  const v = stat.venue || {};
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    description: v.description,
    address: v.address,
    city: v.city,
    country: v.country,
    post_code: v.post_code,
    phone: v.phone,
    website: v.website,
    timezone: v.timezone,
    currency: v.currency,
    active_menu: v.active_menu,
    rating: v.rating?.score ?? null,
    delivery_methods: v.delivery_methods,
    delivery_base_price: v.delivery_base_price,
    service_fee_estimate: v.service_fee_estimate ?? null,
    order_minimum: stat.order_minimum ?? null,
    opening_times: v.opening_times_schedule ?? null,
    delivery_times: v.delivery_times_schedule ?? null,
    allowed_payment_methods: stat.venue_raw?.allowed_payment_methods ?? null,
    is_open: dyn?.venue?.online ?? null,
    estimate_minutes: dyn?.venue?.estimate ?? null,
    estimate_range: v.estimate_range ?? null,
    order_status: dyn?.order_status ?? null,
    dynamic_order_minimum: dyn?.order_minimum ?? null,
  };
}

function shapeItem(i: any, optionsById: Map<string, any> = new Map()) {
  return {
    id: i.id,
    name: i.name,
    description: i.description || null,
    price: i.price,
    net_price: i.net_price ?? null,
    original_price: i.original_price ?? null,
    vat_percentage: i.vat_percentage ?? null,
    in_stock: i.purchasable_balance == null ? true : i.purchasable_balance > 0,
    disabled_reason: i.disabled_info?.reason ?? null,
    allowed_delivery_methods: i.allowed_delivery_methods || null,
    alcohol_permille: i.alcohol_permille ?? 0,
    max_quantity_per_purchase: i.max_quantity_per_purchase ?? null,
    min_quantity_per_purchase: i.min_quantity_per_purchase ?? null,
    dietary_preferences: i.dietary_preferences || [],
    image: i.images?.[0]?.url ?? null,
    checksum: i.checksum ?? null,
    options: (i.options || []).map((op: any) => {
      const def = optionsById.get(op.option_id) || {};
      const range = op.multi_choice_config?.total_range || {};
      return {
        id: op.id,
        option_id: op.option_id,
        name: op.name ?? def.name ?? null,
        type: def.type ?? null,
        required: (range.min ?? 0) > 0,
        min: range.min ?? null,
        max: range.max ?? null,
        max_single_selections: op.multi_choice_config?.max_single_selections ?? null,
        free_selections: op.multi_choice_config?.free_selections ?? null,
        values: (def.values || []).map((v: any) => ({ id: v.id, name: v.name, price: v.price ?? 0, dietary_preferences: v.dietary_preferences || [] })),
      };
    }),
  };
}

async function cmdMenu(slug: string, lat: number, lon: number, filterQ: string, limit: number, lang: string) {
  const [a, venue] = await Promise.all([assortment(slug, lang), cmdVenue(slug, lat, lon).catch(() => ({}) as any)]);
  const byId = new Map((a.items || []).map((i: any) => [i.id, i]));
  const optionsById = new Map((a.options || []).map((op: any) => [op.id, op]));
  const filter = (filterQ || "").toLowerCase();
  const cats = (a.categories || [])
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description || null,
      items: (c.item_ids || [])
        .map((id: string) => byId.get(id))
        .filter(Boolean)
        .map((i: any) => shapeItem(i, optionsById))
        .filter((i: any) => !filter || (i.name || "").toLowerCase().includes(filter) || (i.description || "").toLowerCase().includes(filter)),
    }))
    .filter((c: any) => c.items.length);
  return {
    venue_slug: slug,
    venue_name: (venue as any).name ?? null,
    currency: (venue as any).currency ?? null,
    assortment_id: a.assortment_id ?? null,
    language: a.selected_language ?? null,
    category_count: cats.length,
    item_count: cats.reduce((n: number, c: any) => n + c.items.length, 0),
    categories: limit ? cats.map((c: any) => ({ ...c, items: c.items.slice(0, limit) })) : cats,
  };
}

async function cmdItem(slug: string, itemId: string) {
  const a = await assortment(slug);
  const it = (a.items || []).find((i: any) => i.id === itemId);
  if (!it) throw new Error(`wolt: item ${itemId} not found at ${slug}`);
  return shapeItem(it, new Map((a.options || []).map((op: any) => [op.id, op])));
}

async function cmdEstimate(slug: string, lat: number, lon: number, itemsJson: string | undefined, method: string, tip: number, cfg: Cfg) {
  const v = await cmdVenue(slug, lat, lon);
  let menuItems: any[] = [];
  if (itemsJson) menuItems = JSON.parse(itemsJson).map((m: any) => ({ id: m.id, count: m.count ?? 1, options: m.options ?? [] }));
  const est = await http(C, "/order-xp/web/v1/pages/venue/pricing-estimates", {
    method: "POST",
    body: {
      purchase_plan: {
        venue: { id: v.id, country: v.country, currency: v.currency },
        delivery_method: method || "homedelivery",
        menu_items: menuItems,
        courier_tip: tip,
        use_promo_discount_ids: [],
      },
    },
  });
  return { venue: { id: v.id, slug: v.slug, name: v.name, currency: v.currency }, items: menuItems, estimate: est };
}

// ---------- auth / session ----------
function ravelinDeviceId(): string {
  return "rvnand-6-" + (randomUUID() + randomUUID()).replace(/-/g, "").toUpperCase().slice(0, 64);
}
const hex32 = () => (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 32);

// generated-once identity, persisted
async function ensureIdentity(ctx: ActionContext): Promise<Cfg> {
  const cfg = cfgOf(ctx);
  const patch: Record<string, unknown> = {};
  if (!cfg.visitorId) patch.visitorId = randomUUID();
  if (!cfg.ravelinDeviceId) patch.ravelinDeviceId = ravelinDeviceId();
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  return cfgOf(ctx);
}

async function accessToken(ctx: ActionContext, force = false): Promise<string> {
  const cfg = await ensureIdentity(ctx);
  if (!cfg.refreshToken) throw new Error("wolt: no refresh token — connect an account first (connect action).");
  if (!force && cfg.accessToken && cfg.accessTokenExpiresAt && Date.now() < cfg.accessTokenExpiresAt - 60_000) return cfg.accessToken;
  const resp = await http(AUTH, "/v1/wauth2/access_token", {
    method: "POST",
    web: false,
    body: formEncode({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, device_token: cfg.deviceToken || "" }),
    headers: { ...MOBILE, "content-type": "application/x-www-form-urlencoded", "w-wolt-session-id": randomUUID(), "x-wolt-visitor-id": cfg.visitorId! },
  });
  if (!resp.access_token) throw new Error("wolt: token refresh returned no access_token (refresh token expired? re-connect)");
  const patch: Record<string, unknown> = {
    accessToken: resp.access_token,
    accessTokenExpiresAt: Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3_600_000),
  };
  if (resp.refresh_token) patch.refreshToken = resp.refresh_token;
  await ctx.updateConnection(patch);
  return resp.access_token;
}

async function authed(ctx: ActionContext, host: string, path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const tok = await accessToken(ctx);
  const cfg = cfgOf(ctx);
  return http(host, path, {
    ...opts,
    web: false,
    headers: { ...MOBILE, authorization: `Bearer ${tok}`, "w-wolt-session-id": randomUUID(), "x-wolt-visitor-id": cfg.visitorId!, ...(opts.headers || {}) },
  });
}

// ---------- connect (headless onboarding) ----------
function woltSessionId(cfg: Cfg): string {
  // one stable id links email_login -> validate-number -> start-phone-auth -> the OTP grant.
  return cfg.woltSessionId || randomUUID();
}
function normPhone(p: string): string {
  const d = String(p).replace(/[^\d]/g, "");
  return "+" + (d.startsWith("972") ? d : "972" + d.replace(/^0/, ""));
}
function extractLinkToken(link: string): string {
  let str = String(link).trim();
  if (!/[?&]token=/.test(str) && !/[:/]/.test(str)) return str;
  for (let i = 0; i < 3; i++) {
    const m = str.match(/[?&]token=([^&\s]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (/%25|%3D|%26/.test(str)) {
      str = decodeURIComponent(str);
      continue;
    }
    break;
  }
  throw new Error("wolt connect: could not find a `token` in that link");
}

async function authJson(ctx: ActionContext, path: string, body: unknown, extra: Record<string, string> = {}) {
  const cfg = cfgOf(ctx);
  return http(AUTH, path, { method: "POST", web: false, body, headers: { ...MOBILE, "w-wolt-session-id": woltSessionId(cfg), "x-wolt-visitor-id": cfg.visitorId!, ...extra } });
}
async function authForm(ctx: ActionContext, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  const cfg = cfgOf(ctx);
  return http(AUTH, "/v1/wauth2/access_token", {
    method: "POST",
    web: false,
    body: formEncode(body),
    headers: { ...MOBILE, "content-type": "application/x-www-form-urlencoded", "w-wolt-session-id": woltSessionId(cfg), "x-wolt-visitor-id": cfg.visitorId!, ...extra },
  });
}

async function finishConnect(ctx: ActionContext, resp: any) {
  if (!resp.access_token || !resp.refresh_token) throw new Error("wolt connect: no tokens returned");
  await ctx.updateConnection({
    refreshToken: resp.refresh_token,
    accessToken: resp.access_token,
    accessTokenExpiresAt: Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3_600_000),
    pendingPhone: undefined,
    pendingEmail: undefined,
    pendingOperationToken: undefined,
    pendingConfirmationToken: undefined,
    pendingEmailToken: undefined,
  });
  let card: string | null = null;
  try {
    card = await discoverPaymentMethod(ctx);
  } catch {
    /* best-effort */
  }
  const who = await cmdWhoami(ctx).catch(() => ({}) as any);
  return {
    connected: true,
    account: (who as any).name ?? null,
    addresses: (who as any).address_count ?? null,
    payment_method: card ? "saved card found" : "none found — add a card in the Wolt app to place orders",
    ready_to_order: !!card,
    // Onboarding agent: create a keepalive schedule so the rotating refresh token never lapses.
    // Wolt's refresh is self-sufficient (no live access token needed), so a slow cadence is plenty.
    keepalive: { every: "12h", prompt: "call wolt.refresh()" },
  };
}

async function redeemMagicLink(ctx: ActionContext, token: string) {
  const cfg = cfgOf(ctx);
  const patch: Record<string, unknown> = {};
  if (!cfg.deviceToken) patch.deviceToken = hex32();
  if (!cfg.visitorId) patch.visitorId = randomUUID();
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  const c2 = cfgOf(ctx);
  const resp = await authForm(ctx, { grant_type: "email_login", token, audience: AUDIENCE, device_token: c2.deviceToken, capabilities: CAPABILITIES }).catch((e: WoltError) => {
    let code: unknown = "";
    try {
      code = JSON.parse(e.body || "{}").error_code;
    } catch {
      /* ignore */
    }
    if (code === 126)
      throw new Error("wolt connect: this login link is expired or already used — request a fresh one (connect { email }) and redeem within a few minutes.");
    throw e;
  });
  return finishConnect(ctx, resp);
}

async function cmdConnect(ctx: ActionContext, o: Record<string, unknown>) {
  await ensureIdentity(ctx);

  // magic-link redemption (email-only accounts) — send-free
  if (o.link || o.token) return redeemMagicLink(ctx, extractLinkToken(String(o.link || o.token)));

  // email confirmation code (2nd factor, if the OTP grant escalated)
  if (o.confirmCode) {
    const cfg = cfgOf(ctx);
    if (!cfg.pendingConfirmationToken) throw new Error("wolt connect: no pending confirmation — start with { phone }");
    const bearer = { authorization: `Bearer ${cfg.pendingConfirmationToken}` };
    await http(AUTH, "/v1/access_confirmation/email/submit", {
      method: "POST",
      web: false,
      body: { code: String(o.confirmCode) },
      headers: { ...MOBILE, "w-wolt-session-id": randomUUID(), "x-wolt-visitor-id": cfg.visitorId!, ...bearer },
    });
    const resp = await authForm(ctx, {
      grant_type: "access_confirmation_token",
      access_confirmation_token: cfg.pendingConfirmationToken,
      audience: AUDIENCE,
      device_token: cfg.deviceToken,
    });
    return finishConnect(ctx, resp);
  }

  // submit the login code (email or SMS)
  if (o.code) {
    const cfg = cfgOf(ctx);
    if (!cfg.pendingEmail && !cfg.pendingPhone) throw new Error("wolt connect: no pending login — run { email } or { phone } first");
    let resp: any;
    try {
      resp = cfg.pendingEmail
        ? await authForm(ctx, { grant_type: "email_login_code", email: cfg.pendingEmail, code: String(o.code), audience: AUDIENCE, device_token: cfg.deviceToken, capabilities: CAPABILITIES })
        : await authForm(ctx, { grant_type: "phone_number_otp", phone_number: cfg.pendingPhone, otp: String(o.code), audience: AUDIENCE, device_token: cfg.deviceToken, capabilities: CAPABILITIES, tenant: "wolt" });
    } catch (e) {
      const err = e as WoltError;
      let esc: any = null;
      try {
        esc = JSON.parse(err.body || "");
      } catch {
        /* ignore */
      }
      if (esc?.access_confirmation_token) {
        await ctx.updateConnection({ pendingConfirmationToken: esc.access_confirmation_token });
        const cfg2 = cfgOf(ctx);
        const bearer = { authorization: `Bearer ${cfg2.pendingConfirmationToken}` };
        const st = await http(AUTH, "/v1/access_confirmation/status", {
          method: "POST",
          web: false,
          body: { capabilities: ["email", "phone_number", "google", "facebook", "line", "emag", "strong_authentication", "kyc"] },
          headers: { ...MOBILE, "w-wolt-session-id": randomUUID(), "x-wolt-visitor-id": cfg2.visitorId!, ...bearer },
        }).catch(() => null);
        await http(AUTH, "/v1/access_confirmation/email", { method: "POST", web: false, body: "", headers: { ...MOBILE, "w-wolt-session-id": randomUUID(), "x-wolt-visitor-id": cfg2.visitorId!, ...bearer } });
        return {
          step: "needs_confirmation",
          method: "email",
          account_first_name: esc.access_confirmation_context?.first_name ?? null,
          email_hint: (st?.methods || []).find((m: any) => m.method === "email")?.masked_email ?? null,
          available_methods: (st?.methods || []).map((m: any) => m.method),
          note: "phone verified, but this account needs a second factor. Wolt emailed a confirmation code — run connect({ confirmCode })",
        };
      }
      throw new Error(`wolt connect: OTP exchange failed: ${String(err.message || err)}`);
    }
    return finishConnect(ctx, resp);
  }

  // request an emailed login code/link (email path)
  if (o.email && !o.phone) {
    const patch: Record<string, unknown> = { pendingEmail: String(o.email), pendingPhone: undefined };
    const cfg0 = cfgOf(ctx);
    if (!cfg0.deviceToken) patch.deviceToken = hex32();
    if (!cfg0.visitorId) patch.visitorId = randomUUID();
    await ctx.updateConnection(patch);
    const capHdr = o.captcha ? { "h-captcha-response": String(o.captcha) } : {};
    const r = await authJson(ctx, "/v3/users/email_login", { email: String(o.email), audience: AUDIENCE, email_code_support: true }, capHdr);
    if (r && r.new_user === true && !o.captcha) {
      await ctx.updateConnection({ pendingEmail: undefined });
      return {
        step: "not_registered",
        email: o.email,
        use_instead: "connect({ phone })",
        error: "No Wolt account exists for this address — use the phone number on your account instead: connect({ phone }).",
      };
    }
    return {
      step: "code_sent",
      email: String(o.email),
      includes_code: r?.includes_code ?? null,
      new_user: r?.new_user ?? null,
      next: o.captcha ? "check the inbox for the LINK, then run connect({ phone, emailToken })" : "check your email, then run connect({ code })",
      note: "The email contains a login link and/or a numeric code.",
    };
  }

  // phone path — request the SMS (phone-merge aware)
  if (!o.phone) throw new Error("wolt connect: { email } or { phone } required (or { code } once you have it)");
  const patch: Record<string, unknown> = { pendingPhone: normPhone(String(o.phone)) };
  const cfg0 = cfgOf(ctx);
  if (!cfg0.deviceToken) patch.deviceToken = hex32();
  if (!cfg0.visitorId) patch.visitorId = randomUUID();
  if (!cfg0.woltSessionId) patch.woltSessionId = randomUUID();
  await ctx.updateConnection(patch);
  const cfg = cfgOf(ctx);
  const cap = await authJson(ctx, "/v1/captcha/site_key", { operation: "start_phone_number_authentication_consumer", phone_number: cfg.pendingPhone }).catch(() => ({}) as any);
  await ctx.updateConnection({ pendingOperationToken: cap.operation_token || null });
  const cfg1 = cfgOf(ctx);
  const methods = await authJson(ctx, "/v1/wauth2/consumer-sms/login-methods", {
    phone_number: cfg1.pendingPhone,
    device_token: cfg1.deviceToken,
    operation_token: cfg1.pendingOperationToken,
  }).catch((e: WoltError) => ({ _error: String(e.message || e) }));
  if (o.methodsOnly) return { step: "login_methods", phone: cfg1.pendingPhone, methods };

  const cap2 = (t: unknown) => (t ? { "h-captcha-response": String(t) } : {});
  const emailToken = o.emailToken ? extractLinkToken(String(o.emailToken)) : cfg1.pendingEmailToken || null;
  let validate: any = null;
  if (emailToken) {
    validate = await authJson(
      ctx,
      "/v1/wauth2/consumer-sms/validate-number",
      { phone_number: cfg1.pendingPhone, email_token: emailToken, email: o.email || cfg1.pendingEmail || undefined, use_new_response_format: true },
      cap2(o.vnCaptcha),
    ).catch((e: WoltError) => ({ _error: String(e.message || e) }));
    await ctx.updateConnection({ pendingEmailToken: emailToken });
  }
  await authJson(
    ctx,
    "/v2/wauth2/consumer-sms/start-phone-number-authentication",
    {
      phone_number: cfg1.pendingPhone,
      message_delivery_method: o.viaWhatsapp ? "whatsapp" : "sms",
      device_token: cfg1.deviceToken,
      audience: AUDIENCE,
      capabilities: ["access_confirmation"],
      operation_token: cfg1.pendingOperationToken,
    },
    cap2(o.smsCaptcha),
  );
  return {
    step: "sms_sent",
    phone: cfg1.pendingPhone,
    login_methods: methods,
    ...(validate ? { validate_number: validate } : {}),
    next: "enter the SMS code: connect({ code })",
  };
}

// ---------- payment method / addresses ----------
async function discoverPaymentMethod(ctx: ActionContext): Promise<string | null> {
  const idOf = (m: any) => (m?.id && typeof m.id === "object" ? m.id.$uuid || m.id.$oid : m?.id) || m?.card_id || null;
  for (const [host, path] of [
    [R, "/v3/user/me/payment_methods"],
    [C, "/order-xp/v1/payment-methods"],
  ] as const) {
    try {
      const r = await authed(ctx, host, path);
      const list = r.results?.cards || r.results?.payment_methods || (Array.isArray(r.results) ? r.results : null) || r.payment_methods || r.methods || (Array.isArray(r) ? r : []);
      const card = list.find((m: any) => m.valid_for_payments && idOf(m)) || list.find((m: any) => idOf(m));
      if (card) {
        const id = idOf(card);
        await ctx.updateConnection({ paymentMethodId: id });
        return id;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function getAddresses(ctx: ActionContext) {
  const d = await authed(ctx, R, "/v2/delivery/info");
  return (d.results || []).map((a: any) => ({
    id: a.id,
    alias: a.alias ?? null,
    label_type: a.label_type ?? null,
    is_verified: a.is_verified ?? null,
    address: a.location?.address ?? null,
    city: a.location?.city ?? null,
    street: a.location?.street ?? null,
    apartment: a.location?.apartment ?? null,
    coordinates: a.location?.google_place_coordinates?.coordinates ?? a.location?.user_coordinates?.coordinates ?? null,
    comments: a.location?.address_form_data?.additional_instructions ?? null,
  }));
}
function pickAddress(list: any[], wanted?: string) {
  if (!list.length) throw new Error("wolt: no saved delivery address on the account — add one in the app first");
  if (wanted) {
    const m = list.find((a) => a.id === wanted);
    if (!m) throw new Error(`wolt: address ${wanted} not found`);
    return m;
  }
  return list[0];
}

async function cmdWhoami(ctx: ActionContext) {
  const me = await authed(ctx, R, "/v1/user/me");
  const u = me.user || {};
  return { id: u._id?.$oid ?? null, name: u.name ?? null, has_account: !!u._id, address_count: (await getAddresses(ctx)).length };
}

// ---------- ordering ----------
async function resolveItems(slug: string, selections: any[]) {
  const a = await assortment(slug);
  const itemsById = new Map((a.items || []).map((i: any) => [i.id, i]));
  const optionsById = new Map((a.options || []).map((op: any) => [op.id, op]));
  const catOfItem = new Map<string, string>();
  for (const c of a.categories || []) for (const id of c.item_ids || []) if (!catOfItem.has(id)) catOfItem.set(id, c.id);

  const menu_items: any[] = [];
  const purchase_items: any[] = [];
  for (const sel of selections) {
    const it: any = itemsById.get(sel.id);
    if (!it) throw new Error(`wolt: item ${sel.id} not on venue ${slug}`);
    const count = sel.count ?? 1;
    const catId = catOfItem.get(sel.id) || null;
    let optSum = 0;
    const coOpts: any[] = [];
    const puOpts: any[] = [];
    for (const grp of sel.options || []) {
      const itemGrp = (it.options || []).find((op: any) => op.id === grp.id);
      if (!itemGrp) throw new Error(`wolt: option group ${grp.id} not on item ${sel.id}`);
      const def: any = optionsById.get(itemGrp.option_id) || {};
      const values = (grp.values || []).map((v: any) => {
        const dv = (def.values || []).find((x: any) => x.id === v.id) || {};
        const price = dv.price ?? 0;
        const c = v.count ?? 1;
        optSum += price * c;
        return { id: v.id, price, count: c };
      });
      coOpts.push({ id: grp.id, values: values.map(({ id, price, count }: any) => ({ id, price, count })) });
      puOpts.push({ id: { $oid: grp.id }, type: def.type || "Multichoice", values: values.map((v: any) => ({ id: { $oid: v.id }, price: v.price, count: v.count })) });
    }
    const basePrice = it.price ?? 0;
    const endAmount = (basePrice + optSum) * count;
    menu_items.push({
      id: sel.id,
      count,
      options: coOpts,
      base_price: basePrice,
      end_amount: endAmount,
      category_id: catId,
      category_ids: catId ? [catId] : [],
      exclude_from_discounts: false,
      exclude_from_discounts_min_basket: false,
      exclude_from_credits: false,
      alcohol_permille: it.alcohol_permille ?? 0,
      restrictions: [],
    });
    purchase_items.push({
      id: { $oid: sel.id },
      baseprice: basePrice,
      options: puOpts,
      count,
      end_amount: endAmount,
      alcohol_percentage: 0,
      checksum: it.checksum,
      substitution_settings: { is_allowed: true },
      from_recommendation: false,
    });
  }
  return { menu_items, purchase_items };
}

async function doCheckout(ctx: ActionContext, venue: any, addr: any, menu_items: any[], tip: number) {
  const cfg = cfgOf(ctx);
  const coords = addr.coordinates || [];
  const [lng, lat] = coords.length === 2 ? coords : [null, null];
  const plan = {
    purchase_plan: {
      delivery: { delivery_coordinates: { latitude: lat, longitude: lng }, delivery_info_id: addr.id },
      venue: { id: venue.id, country: venue.country, currency: venue.currency },
      delivery_method: "homedelivery",
      menu_items,
      use_cash: false,
      selected_offer_ids: [],
      pre_considered_discount_ids: [],
      courier_tip: tip,
      use_loyalty_points_amount: 0,
      use_credits_and_tokens: true,
      did_client_disable_purchase: false,
      payment_methods: cfg.paymentMethodId ? [{ id: cfg.paymentMethodId, type: "card" }] : [],
      delivery_config: { method: "homedelivery", schedule: "standard" },
      is_partial_address: false,
    },
  };
  return authed(ctx, C, "/order-xp/mobile/v2/pages/checkout", { method: "POST", body: plan });
}

async function placePurchase(ctx: ActionContext, venue: any, addr: any, purchase_items: any[], checkout: any, tip: number, estimate: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.paymentMethodId) throw new Error("wolt: no saved card (paymentMethodId) — Google Pay is not replayable, a saved card is required");
  const pv = checkout.purchase_validation || {};
  const coords = addr.coordinates || [];
  const [lng, lat] = coords.length === 2 ? coords : [null, null];
  const body = {
    venue_id: venue.id,
    checkout_id: checkout.id,
    payment_method_id: cfg.paymentMethodId,
    payment_method_type: "card",
    end_amount: pv.end_amount ?? checkout.payable_amount,
    end_amount_rounding: pv.end_amount_rounding ?? 0,
    items: purchase_items,
    client_pre_estimate: estimate,
    signature_datetime: { $date: Date.now() },
    client_nonce: randomUUID(),
    delivery_method: "homedelivery",
    currency: venue.currency,
    preorder: false,
    no_credits_or_tokens: false,
    credits_amount: pv.credits_amount ?? 0,
    delivery_price: pv.delivery_price ?? 0,
    delivery_info: {
      id: { $oid: addr.id },
      delivery_comments: "\n",
      location: { address: addr.address, city: addr.city, coordinates: { coordinates: [lng, lat], type: "Point" } },
      use_last_100m_address_picker: true,
    },
    tip_amount: tip,
    language: "en",
    additional_checkout_options: { no_contact_delivery: false },
    ravelin_device_id: cfg.ravelinDeviceId,
    browser_info: { color_depth: 32, screen_width: 1080, screen_height: 2400, time_zone_offset: -180, java_enabled: false, language: "en", ravelin_device_id: cfg.ravelinDeviceId },
    to: { id: { $oid: venue.id }, type: "venue" },
    signature: "N/A",
    type: "purchase",
    device_channel: "app",
    pricing_model_version: 2023,
    use_self_service_cancellation: false,
    discounts: pv.discounts ?? [],
    surcharges: pv.surcharges ?? [],
    offers: pv.offers ?? [],
    menu_items_source: "consumer-assortment",
  };
  return authed(ctx, R, "/v2/purchases", { method: "POST", body });
}

async function cmdOrderCreate(ctx: ActionContext, slug: string, o: Record<string, unknown>) {
  if (!o.items) throw new Error('wolt order_create: items required, e.g. [{"id":"<itemId>","count":1,"options":[{"id":"<groupId>","values":[{"id":"<valueId>","count":1}]}]}]');
  const cfg = cfgOf(ctx);
  const selections = typeof o.items === "string" ? JSON.parse(o.items) : o.items;
  const lat = num(o.lat ?? cfg.defaultLat, DEF_LAT);
  const lon = num(o.lon ?? cfg.defaultLon, DEF_LON);
  const tip = num(o.tip, 0);
  const venue = await cmdVenue(slug, lat, lon);
  const addresses = await getAddresses(ctx);
  const addr = pickAddress(addresses, o.address ? String(o.address) : undefined);
  const { menu_items, purchase_items } = await resolveItems(slug, selections);
  const checkout = await doCheckout(ctx, venue, addr, menu_items, tip);
  if (checkout.purchasing_disabled)
    return { ok: false, purchasing_disabled: true, reason: checkout.call_to_action?.text || checkout.purchase_validation || "purchasing disabled by Wolt", checkout_id: checkout.id };
  const dc =
    (checkout.delivery_configs || []).find((c: any) => c.method === "homedelivery" && c.schedule === "standard" && c.estimate?.max) ||
    (checkout.delivery_configs || []).find((c: any) => c.estimate?.max);
  const estimate = dc?.estimate?.max
    ? `${dc.estimate.min}-${dc.estimate.max}`
    : (venue as any).estimate_range
      ? `${(venue as any).estimate_range.min}-${(venue as any).estimate_range.max}`
      : venue.estimate_minutes
        ? `${venue.estimate_minutes}-${venue.estimate_minutes + 10}`
        : "30-45";
  const preview = {
    venue: { id: venue.id, slug: venue.slug, name: venue.name, currency: venue.currency },
    deliver_to: { id: addr.id, address: addr.address, city: addr.city },
    items: menu_items.map((m) => ({ id: m.id, count: m.count, amount: m.end_amount })),
    payable_amount: checkout.payable_amount,
    delivery_price: checkout.purchase_validation?.delivery_price ?? null,
    currency: venue.currency,
    estimate_minutes: estimate,
    checkout_id: checkout.id,
  };
  if (o.confirm !== true)
    return { requiresConfirmation: true, action: "wolt order_create", summary: preview, note: "This spends real money and orders real food. Re-run with confirm:true to place." };
  if (!cfg.allowOrdering) throw new Error("wolt order_create: ordering is disabled for this connection (set allowOrdering:true). Refusing to place.");
  const res = await placePurchase(ctx, venue, addr, purchase_items, checkout, tip, estimate);
  const r0 = Array.isArray(res.results) ? res.results[0] : res.results;
  const orderId = r0?.id?.$oid || r0?.id || res.id?.$oid || res.id || res.purchase_id || null;
  return { ok: true, status: "placed", order_id: orderId, payable_amount: checkout.payable_amount, currency: venue.currency, deliver_to: preview.deliver_to, track_with: `order_status(${orderId})` };
}

async function cmdOrderStatus(ctx: ActionContext, purchaseId: string) {
  const [track, page] = await Promise.all([
    authed(ctx, R, `/v2/order_details/purchase_tracking/${purchaseId}`).catch(() => null),
    authed(ctx, C, `/order-xp/v1/pages/order-tracking/${purchaseId}`).catch(() => null),
  ]);
  const od = track?.order_details || {};
  return {
    order_id: purchaseId,
    status: page?.purchase_context?.purchase_status ?? null,
    venue: page?.purchase_context?.venue_name ?? null,
    eta: od.delivery_eta?.$date ? new Date(od.delivery_eta.$date).toISOString() : null,
    delivery_distance: od.delivery_distance ?? null,
    handshake_code: od.delivery_handshake_code ?? null,
    couriers: (track?.drivers || []).map((d: any) => ({ name: d.name ?? null, coordinates: d.coordinates ?? d.location ?? null })),
    currency: od.currency ?? null,
    poll_after_seconds: track?.expires_in_seconds ?? null,
  };
}

async function cmdOrderCancel(ctx: ActionContext, purchaseId: string, reason: string) {
  try {
    const res = await authed(ctx, R, `/v2/purchases/${purchaseId}/cancel`, { method: "PUT", body: { cancellation_reason: reason } });
    return { ok: true, cancelled: true, order_id: purchaseId, reason, response: res ?? null };
  } catch (e) {
    const err = e as WoltError;
    let msg = String(err.message || err);
    let code: unknown = null;
    try {
      const j = JSON.parse(err.body || "{}");
      msg = j.msg || msg;
      code = j.error_code ?? null;
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      cancelled: false,
      order_id: purchaseId,
      error_code: code,
      reason_declined: msg,
      note: code === 4051 ? "The venue already received the order — self-service cancel is no longer possible; contact Wolt support." : undefined,
    };
  }
}

// ---------- plugin ----------
export default function wolt(rl: RunlinePluginAPI) {
  rl.setName("wolt");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    refreshToken: { type: "string", required: false, description: "Refresh JWT from an owner login (rotates; persisted). Set by connect().", env: "WOLT_REFRESH_TOKEN" },
    deviceToken: { type: "string", required: false, description: "Device token bound to the session (generated on connect).", env: "WOLT_DEVICE_TOKEN" },
    visitorId: { type: "string", required: false, description: "x-wolt-visitor-id (generated if absent).", env: "WOLT_VISITOR_ID" },
    ravelinDeviceId: { type: "string", required: false, description: "Ravelin fraud fingerprint (rvnand-6-<64hex>); generated + persisted if absent.", env: "WOLT_RAVELIN_DEVICE_ID" },
    paymentMethodId: { type: "string", required: false, description: "Saved card id charged for orders. Auto-discovered on connect.", env: "WOLT_PAYMENT_METHOD_ID" },
    defaultLat: { type: "string", required: false, description: "Home latitude for reads that carry none (e.g. 32.0853).", env: "WOLT_DEFAULT_LAT" },
    defaultLon: { type: "string", required: false, description: "Home longitude (e.g. 34.7818).", env: "WOLT_DEFAULT_LON" },
    allowOrdering: { type: "boolean", required: false, default: false, description: "Master switch for placing/cancelling orders. Off = read-only. Even on, order_create still needs confirm:true." },
  });

  const latOf = (ctx: ActionContext, p: any) => num(p?.lat ?? cfgOf(ctx).defaultLat, DEF_LAT);
  const lonOf = (ctx: ActionContext, p: any) => num(p?.lon ?? cfgOf(ctx).defaultLon, DEF_LON);

  rl.registerAction("search", {
    access: "read",
    description: "Search Wolt for venues (restaurants, groceries, shops) by name/cuisine near a location. Returns venues with slug, rating, delivery price and ETA. Anonymous, read-only. Hebrew works.",
    inputSchema: {
      query: { type: "string", required: true, description: "Search text, e.g. 'sushi' or 'pharmacy'." },
      lat: { type: "number", required: false, description: "Latitude (defaults to the connection's home)." },
      lon: { type: "number", required: false, description: "Longitude." },
      limit: { type: "number", required: false, description: "Max venues (default 20)." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdSearch(String(p.query), latOf(ctx, p), lonOf(ctx, p), num(p.limit, 20));
    },
  });

  rl.registerAction("nearby", {
    access: "read",
    description: "List venues near a location (Wolt city frontpage). Optionally only open venues. Anonymous, read-only.",
    inputSchema: {
      lat: { type: "number", required: false, description: "Latitude (defaults to home)." },
      lon: { type: "number", required: false, description: "Longitude." },
      limit: { type: "number", required: false, description: "Max venues (default 30)." },
      open_only: { type: "boolean", required: false, description: "Only currently-open venues." },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return cmdNearby(latOf(ctx, p), lonOf(ctx, p), num(p.limit, 30), p.open_only === true);
    },
  });

  rl.registerAction("venue", {
    access: "read",
    description: "Full details for one venue by slug: address, currency, open/closed, ETA, delivery fee, order minimum, opening/delivery schedules. Anonymous, read-only.",
    inputSchema: {
      slug: { type: "string", required: true, description: "Venue slug (from search/nearby)." },
      lat: { type: "number", required: false, description: "Latitude (defaults to home)." },
      lon: { type: "number", required: false, description: "Longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdVenue(String(p.slug), latOf(ctx, p), lonOf(ctx, p));
    },
  });

  rl.registerAction("menu", {
    access: "read",
    description: "Read a venue's full menu by slug: categories and items with prices (minor units), stock, and normalised option groups (required flags, choices, prices). Optionally filter items by text. Anonymous, read-only.",
    inputSchema: {
      slug: { type: "string", required: true, description: "Venue slug." },
      q: { type: "string", required: false, description: "Filter items by name/description." },
      limit: { type: "number", required: false, description: "Max items per category (0 = all)." },
      lat: { type: "number", required: false, description: "Latitude for the venue lookup." },
      lon: { type: "number", required: false, description: "Longitude." },
      lang: { type: "string", required: false, description: "Assortment language (default 'en')." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdMenu(String(p.slug), latOf(ctx, p), lonOf(ctx, p), p.q ? String(p.q) : "", num(p.limit, 0), p.lang ? String(p.lang) : "en");
    },
  });

  rl.registerAction("item", {
    access: "read",
    description: "One menu item's full detail (price, options, checksum) by venue slug + item id. Anonymous, read-only.",
    inputSchema: {
      slug: { type: "string", required: true, description: "Venue slug." },
      item_id: { type: "string", required: true, description: "Item id (from menu)." },
    },
    async execute(input) {
      const p = input as Record<string, unknown>;
      return cmdItem(String(p.slug), String(p.item_id));
    },
  });

  rl.registerAction("estimate", {
    access: "read",
    description: "Price estimate for a venue (and optionally a cart of items): delivery fee + totals. Works with an empty cart for a delivery-fee estimate. Anonymous, read-only.",
    inputSchema: {
      slug: { type: "string", required: true, description: "Venue slug." },
      items: { type: "string", required: false, description: 'JSON array of {id,count,options?} to price a cart.' },
      method: { type: "string", required: false, description: "Delivery method (default 'homedelivery')." },
      tip: { type: "number", required: false, description: "Courier tip in minor units." },
      lat: { type: "number", required: false, description: "Latitude." },
      lon: { type: "number", required: false, description: "Longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdEstimate(String(p.slug), latOf(ctx, p), lonOf(ctx, p), p.items ? String(p.items) : undefined, p.method ? String(p.method) : "homedelivery", num(p.tip, 0), cfgOf(ctx));
    },
  });

  rl.registerAction("connect", {
    access: "write",
    description:
      "Owner login for the Wolt account, headless. Paths by account type: email code (connect({ email, captcha }) -> connect({ code })); email magic LINK (connect({ link })); phone / Google-social (connect({ phone, emailToken, vnCaptcha, smsCaptcha }) -> connect({ code }) -> connect({ confirmCode })). Probe with connect({ phone, methodsOnly:true }). Every email/SMS SEND needs a fresh passive hCaptcha token (captcha/vnCaptcha/smsCaptcha) minted in a real browser on a wolt.com origin; redeeming a link is the only send-free step. After success the refresh token drives everything.",
    inputSchema: {
      email: { type: "string", required: false, description: "Account (or throwaway) email to request a login code/link." },
      phone: { type: "string", required: false, description: "Account phone (international or local IL digits)." },
      code: { type: "string", required: false, description: "The emailed/SMS one-time code." },
      confirmCode: { type: "string", required: false, description: "Second-factor email confirmation code (phone-merge escalation)." },
      link: { type: "string", required: false, description: "Full magic-link URL (or raw token) to redeem — no captcha needed." },
      token: { type: "string", required: false, description: "Bare magic-link token (alternative to link)." },
      emailToken: { type: "string", required: false, description: "Magic-link URL/token from a throwaway email_login, to unlock the phone-merge validate-number." },
      captcha: { type: "string", required: false, description: "Fresh h-captcha-response for the email_login send." },
      vnCaptcha: { type: "string", required: false, description: "Fresh h-captcha-response for validate-number (phone-merge)." },
      smsCaptcha: { type: "string", required: false, description: "Fresh h-captcha-response for start-phone-authentication." },
      viaWhatsapp: { type: "boolean", required: false, description: "Deliver the code by WhatsApp instead of SMS." },
      methodsOnly: { type: "boolean", required: false, description: "Only ask Wolt what this account can log in with; sends nothing." },
    },
    async execute(input, ctx) {
      return cmdConnect(ctx, (input ?? {}) as Record<string, unknown>);
    },
  });

  rl.registerAction("refresh", {
    access: "write",
    description:
      "Keepalive: force a token refresh so the rotating session never lapses. After connect(), the onboarding agent should create a recurring schedule that runs the one-line prompt 'call wolt.refresh()' every ~12h (Wolt's refresh needs no live access token, so a slow cadence is plenty). Returns the new access-token expiry.",
    inputSchema: {},
    async execute(_input, ctx) {
      await accessToken(ctx, true);
      const cfg = cfgOf(ctx);
      return { refreshed: true, access_expires_at: cfg.accessTokenExpiresAt ? new Date(cfg.accessTokenExpiresAt).toISOString() : null };
    },
  });

  rl.registerAction("whoami", {
    access: "read",
    description: "The connected Wolt account: id, name, and saved-address count. Confirms the session is authenticated.",
    inputSchema: {},
    async execute(_input, ctx) {
      return cmdWhoami(ctx);
    },
  });

  rl.registerAction("addresses", {
    access: "read",
    description: "The account's saved delivery addresses (id, alias, address, coordinates). You need one to place an order.",
    inputSchema: {},
    async execute(_input, ctx) {
      return getAddresses(ctx);
    },
  });

  rl.registerAction("order_create", {
    access: "write",
    description:
      "Place a REAL, paid Wolt order — this spends money and orders real food. Call FIRST without confirm to get a priced preview (items, payable amount, delivery fee, ETA, delivery address) and a requiresConfirmation flag; read it back, get an explicit yes, then call again with confirm:true. Requires the connection's allowOrdering. Payment is the account's saved card.",
    inputSchema: {
      slug: { type: "string", required: true, description: "Venue slug." },
      items: { type: "string", required: true, description: 'JSON array of selections: [{"id":"<itemId>","count":1,"options":[{"id":"<groupId>","values":[{"id":"<valueId>","count":1}]}]}]' },
      address: { type: "string", required: false, description: "Delivery address id (from addresses). Defaults to the first saved address." },
      tip: { type: "number", required: false, description: "Courier tip in minor units." },
      confirm: { type: "boolean", required: false, description: "Set true ONLY after the person heard the total + address and said yes. Actually places (and pays for) the order." },
      lat: { type: "number", required: false, description: "Latitude for the venue lookup." },
      lon: { type: "number", required: false, description: "Longitude." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdOrderCreate(ctx, String(p.slug), p);
    },
  });

  rl.registerAction("order_status", {
    access: "read",
    description: "Track an order ('where's my food'): status, ETA, courier hand-off code and location, delivery distance. Needs the order id from order_create.",
    inputSchema: { order_id: { type: "string", required: true, description: "Order id from order_create." } },
    async execute(input, ctx) {
      return cmdOrderStatus(ctx, String((input as Record<string, unknown>).order_id));
    },
  });

  rl.registerAction("order_cancel", {
    access: "write",
    description: "Cancel an order — self-service, only in the short window BEFORE the venue accepts it (afterwards Wolt returns error_code 4051 and you must contact support). Stops a charge; still requires the order id.",
    inputSchema: {
      order_id: { type: "string", required: true, description: "Order id from order_create." },
      reason: { type: "string", required: false, description: "Cancellation reason (default 'ordered_by_mistake')." },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return cmdOrderCancel(ctx, String(p.order_id), p.reason ? String(p.reason) : "ordered_by_mistake");
    },
  });
}
