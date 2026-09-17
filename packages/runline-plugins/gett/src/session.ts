import type { ActionContext } from "runline";
import {
  APP_VERSION,
  arr,
  authed,
  cfgOf,
  DEF_LAT,
  DEF_LON,
  ensureDevice,
  expiresAt,
  http,
  normPhone,
  num,
  obj,
  pick,
  seg,
} from "./shared.js";

/**
 * The owner login and the session it bootstraps.
 *
 * Three steps, because Gett asks for three things: a phone to text, the code it
 * texted, and the last digits of the saved card as a second factor. A trusted
 * device skips the third. Each step is its own action so its schema can require
 * what it actually needs.
 */

export interface Identity {
  global_user_id: string | null;
  name: string | null;
  phone: string | null;
}

/** Non-fatal problems during login: the session is usable, something optional is not. */
type Warnings = string[];

export async function requestCode(ctx: ActionContext, phone?: string) {
  await ensureDevice(ctx);
  let cfg = cfgOf(ctx);
  if (phone) {
    await ctx.updateConnection({ phone: normPhone(phone) });
    cfg = cfgOf(ctx);
  }
  if (!cfg.phone)
    throw new Error(
      "gett: no phone — pass { phone } (e.g. 972500000000) or set GETT_PHONE",
    );
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
  // Gett answers 200 even when it refuses to send (rate limit / block); the verdict
  // is in the body's rc/status, not the HTTP code. Success is rc:0 / status:"success".
  // Report a refusal rather than claiming an SMS that will never arrive.
  const status = pick(r.status);
  if ((r.rc != null && r.rc !== 0) || (status && status !== "success")) {
    const mins = r.blocked_until != null ? num(r.blocked_until, 0) : null;
    return {
      sent: false,
      blocked: status === "blocked",
      phone: cfg.phone,
      status,
      retry_after_minutes: mins,
      note:
        status === "blocked"
          ? `Too many attempts — Gett blocked new codes${mins ? ` for ~${mins} min` : ""}. Wait, then call account.requestCode again.`
          : "No SMS was sent. Check the phone digits, then call account.requestCode again.",
    };
  }
  return {
    sent: true,
    phone: cfg.phone,
    code_length: num(r.confirmation_code_length, 6),
    next: "account.verifyCode({ code })",
  };
}

/** Tokens arrive either at the top level or nested under `tokens`. */
function tokensIn(r: Record<string, unknown>): Record<string, unknown> | null {
  const nested = obj(r.tokens);
  if (pick(nested.refresh_token)) return nested;
  if (pick(r.refresh_token)) return r;
  return null;
}

export async function verifyCode(ctx: ActionContext, code: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.phone)
    throw new Error("gett: no phone — call account.requestCode first");
  const r = await http(
    ctx,
    `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/otp/verify`,
    { method: "POST", body: { code } },
  );
  const toks = tokensIn(r);
  if (toks) {
    const warnings = await finishTokens(ctx, toks);
    // `connected` comes from status(), which reads what was actually persisted,
    // rather than from the branch that hoped it would be.
    return { mfa_required: false, warnings, ...(await status(ctx)) };
  }
  const mfa = r.mfa_required === true || pick(r.status) === "mfa_required";
  // An auth response can carry tokens; report its shape, never its contents.
  if (!mfa)
    throw new Error(
      `gett: otp/verify returned neither tokens nor an MFA challenge (fields: ${Object.keys(r).sort().join(", ") || "none"})`,
    );
  await ctx.updateConnection({
    pendingTempCode: pick(r.temp_code) ?? undefined,
  });
  return {
    connected: false,
    mfa_required: true,
    challenge: pick(r.mfa_challenge),
    methods: arr(r.mfa_methods).filter((m) => typeof m === "string"),
    masked_email: pick(r.mfa_masked_email),
    next: "account.verifyCard({ card })",
  };
}

export async function verifyCard(ctx: ActionContext, digits: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.pendingTempCode)
    throw new Error("gett: no pending MFA — call account.verifyCode first");
  const r = await http(
    ctx,
    `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/mfa/verify`,
    {
      method: "POST",
      body: { temp_code: cfg.pendingTempCode, card_digits: digits },
    },
  );
  const toks = tokensIn(r);
  if (!toks) {
    const reported = pick(r.status);
    throw new Error(
      `gett: mfa/verify did not return tokens${reported ? ` (status: ${reported})` : ""} — check the card digits and retry`,
    );
  }
  await ctx.updateConnection({ pendingTempCode: undefined });
  const warnings = await finishTokens(ctx, toks);
  return { warnings, ...(await status(ctx)) };
}

/**
 * Store the IL-scoped tokens, convert to the GL family the app uses for ongoing
 * refresh, then learn identity and the saved card.
 *
 * The conversion and the discovery are both optional: an IL token still serves
 * reads, and a missing card only blocks booking. Neither failure is allowed to
 * lose a login that otherwise succeeded, so both are reported as warnings rather
 * than swallowed or thrown.
 */
async function finishTokens(
  ctx: ActionContext,
  toks: Record<string, unknown>,
): Promise<Warnings> {
  const warnings: Warnings = [];
  await ctx.updateConnection({
    refreshToken: pick(toks.refresh_token),
    accessToken: pick(toks.access_token),
    accessTokenExpiresAt: expiresAt(toks.expires_in),
  });
  const cfg = cfgOf(ctx);
  try {
    // `?lc=en` is required here too: the conversion 400s without it even with a
    // valid IL bearer.
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
    const rotated = pick(gl.refresh_token);
    const issued = pick(gl.access_token);
    if (rotated) patch.refreshToken = rotated;
    if (issued) {
      patch.accessToken = issued;
      patch.accessTokenExpiresAt = expiresAt(gl.expires_in);
    }
    if (Object.keys(patch).length) await ctx.updateConnection(patch);
  } catch (e) {
    warnings.push(
      `IL->GL token conversion failed (${(e as Error).message}); reads work, but the session may need an earlier re-login.`,
    );
  }
  try {
    await createSession(ctx, DEF_LAT, DEF_LON);
  } catch (e) {
    warnings.push(
      `identity and saved-card discovery failed (${(e as Error).message}); booking needs creditCardId, so re-run account.get.`,
    );
  }
  return warnings;
}

/** The default saved card, out of a create_session response. */
function discoverCard(session: Record<string, unknown>): string | null {
  for (const entry of arr(obj(obj(session.payment_methods).data).list)) {
    for (const pm of arr(obj(entry).payment_methods)) {
      const cards = arr(obj(obj(obj(pm).additional_data).credit_card).cards);
      const preferred =
        cards.find((c) => obj(c).is_default === true) ?? cards[0];
      const id = pick(obj(preferred).card_id);
      if (id) return id;
    }
  }
  return null;
}

/** Local view of the connection. No network, so it works on a broken session. */
export async function status(ctx: ActionContext) {
  const cfg = cfgOf(ctx);
  const missing: string[] = [];
  if (!cfg.phone) missing.push("phone");
  if (!cfg.refreshToken) missing.push("refreshToken (owner login)");
  if (!cfg.creditCardId)
    missing.push("creditCardId (auto-discovered on login)");
  return {
    connected: !!cfg.refreshToken,
    phone: cfg.phone ?? null,
    name: cfg.name ?? null,
    globalUserId: cfg.globalUserId ?? null,
    creditCard: cfg.creditCardId ?? null,
    pendingMfa: !!cfg.pendingTempCode,
    orderingEnabled: cfg.allowOrdering === true,
    missing,
    // The GL refresh token is long-lived (~90d) and its grant does not need a live
    // access token, so a stored session survives unattended: no keepalive schedule.
    keepalive: null,
  };
}

/**
 * The app's session bootstrap. Also the only place identity and the saved card
 * are learned, so pricing and booking call it before they need either.
 */
export async function createSession(
  ctx: ActionContext,
  lat: number,
  lon: number,
): Promise<Record<string, unknown>> {
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
  const profile = obj(r.user_profile);
  const patch: Record<string, unknown> = {};
  const globalUserId = pick(profile.global_user_id);
  const name = pick(profile.first_name);
  if (globalUserId && !cfg.globalUserId) patch.globalUserId = globalUserId;
  if (name && !cfg.name) patch.name = name;
  if (!cfg.creditCardId) {
    const card = discoverCard(r);
    if (card) patch.creditCardId = card;
  }
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  return r;
}

export function identityOf(
  ctx: ActionContext,
  session: Record<string, unknown>,
): Identity {
  const cfg = cfgOf(ctx);
  const profile = obj(session.user_profile);
  return {
    global_user_id: pick(profile.global_user_id, cfg.globalUserId),
    name: pick(profile.first_name, cfg.name),
    phone: cfg.phone ?? null,
  };
}

/** The rider block Gett expects inside every stop. */
export function rider(ctx: ActionContext) {
  const cfg = cfgOf(ctx);
  return {
    global_id: num(cfg.globalUserId, 0),
    name: cfg.name || "",
    phone: cfg.phone,
    vip: { is_vip: false, level: 0 },
  };
}
