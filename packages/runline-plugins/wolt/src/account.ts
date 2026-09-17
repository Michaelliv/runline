import type { ActionContext } from "runline";
import {
  AUDIENCE,
  AUTH,
  arr,
  authed,
  CAPABILITIES,
  type Cfg,
  CONSUMER,
  cfgOf,
  clientHeaders,
  ensureIdentity,
  expiresAt,
  formEncode,
  http,
  normPhone,
  obj,
  pick,
  RESTAURANT,
  WoltError,
} from "./shared.js";

/**
 * The owner login, and what a logged-in session knows.
 *
 * Wolt reaches one account through several doors — an emailed code, an emailed
 * magic link, or a phone number merged with a social account — and every door
 * that SENDS something is fronted by a passive hCaptcha token minted in a real
 * browser on a wolt.com origin. Redeeming a link is the only send-free step.
 * Each door is its own action so its schema can require what that door needs.
 */

type Warnings = string[];

async function authJson(
  ctx: ActionContext,
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  return http(AUTH, path, {
    method: "POST",
    web: false,
    body,
    headers: { ...clientHeaders(cfgOf(ctx)), ...extra },
  });
}

async function authForm(
  ctx: ActionContext,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  return http(AUTH, "/v1/wauth2/access_token", {
    method: "POST",
    web: false,
    body: formEncode(body),
    headers: {
      ...clientHeaders(cfgOf(ctx)),
      "content-type": "application/x-www-form-urlencoded",
      ...extra,
    },
  });
}

const captchaHeader = (token: unknown): Record<string, string> =>
  token ? { "h-captcha-response": String(token) } : {};

/** The query of a URL, or of a bare `a=b&c=d` fragment. */
function queryOf(text: string): URLSearchParams | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    try {
      return new URL(text).searchParams;
    } catch {
      /* not a URL after all */
    }
  }
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  return query.includes("=") ? new URLSearchParams(query) : null;
}

/**
 * The token out of a magic link.
 *
 * Wolt's emails wrap the real link in a redirect, so the token can sit one or
 * two query layers down. Each layer is unwrapped with URLSearchParams, which
 * decodes exactly once and leaves a malformed escape alone rather than throwing
 * a URIError from inside a login.
 */
export function linkToken(link: string): string {
  const text = String(link).trim();
  if (!text) throw new Error("wolt: empty login link");
  // A bare token carries none of a URL's punctuation.
  if (!/[:/?&=]/.test(text)) return text;
  let layers = [text];
  for (let depth = 0; depth < 3 && layers.length; depth++) {
    const nested: string[] = [];
    for (const layer of layers) {
      const params = queryOf(layer);
      if (!params) continue;
      const token = params.get("token");
      if (token) return token;
      for (const [, value] of params)
        if (value.includes("token=")) nested.push(value);
    }
    layers = nested;
  }
  throw new Error("wolt: no `token` found in that link");
}

/** Persist the grant and learn what ordering will need. */
async function finish(
  ctx: ActionContext,
  grant: Record<string, unknown>,
): Promise<{ warnings: Warnings } & Record<string, unknown>> {
  const access = pick(grant.access_token);
  const refresh = pick(grant.refresh_token);
  if (!access || !refresh)
    throw new Error("wolt: the login grant returned no tokens");
  await ctx.updateConnection({
    refreshToken: refresh,
    accessToken: access,
    accessTokenExpiresAt: expiresAt(grant.expires_in),
    pendingPhone: undefined,
    pendingEmail: undefined,
    pendingOperationToken: undefined,
    pendingConfirmationToken: undefined,
    pendingEmailToken: undefined,
  });

  // A card and an address are what ordering needs; neither failing is allowed
  // to lose a login that worked, so both come back as warnings.
  const warnings: Warnings = [];
  let card: string | null = null;
  try {
    card = await discoverPaymentMethod(ctx);
  } catch (e) {
    warnings.push(`payment-method discovery failed (${(e as Error).message})`);
  }
  if (!card)
    warnings.push(
      "no saved card on the account — add one in the Wolt app before ordering (Google Pay cannot be replayed headless)",
    );
  let addresses = 0;
  try {
    addresses = (await listAddresses(ctx)).length;
  } catch (e) {
    warnings.push(`address lookup failed (${(e as Error).message})`);
  }
  if (addresses === 0)
    warnings.push("no saved delivery address — add one in the Wolt app");

  return {
    connected: true,
    ready_to_order: Boolean(card) && addresses > 0,
    saved_addresses: addresses,
    warnings,
    // Wolt rotates the refresh token on every grant, so an untouched session
    // eventually lapses. A slow schedule is enough: the grant needs no live
    // access token.
    keepalive: { every: "12h", prompt: "call wolt.account.refresh()" },
  };
}

export async function redeemLink(ctx: ActionContext, link: string) {
  await ensureIdentity(ctx);
  const cfg = cfgOf(ctx);
  const token = linkToken(link);
  try {
    const grant = await authForm(ctx, {
      grant_type: "email_login",
      token,
      audience: AUDIENCE,
      device_token: cfg.deviceToken,
      capabilities: CAPABILITIES,
    });
    return finish(ctx, grant);
  } catch (e) {
    if (e instanceof WoltError && e.details().error_code === 126)
      throw new Error(
        "wolt: that login link is expired or already used — request a fresh one and redeem it within a few minutes",
      );
    throw e;
  }
}

export async function requestEmailCode(
  ctx: ActionContext,
  email: string,
  captcha?: string,
) {
  await ensureIdentity(ctx);
  await ctx.updateConnection({ pendingEmail: email, pendingPhone: undefined });
  const r = await authJson(
    ctx,
    "/v3/users/email_login",
    { email, audience: AUDIENCE, email_code_support: true },
    captchaHeader(captcha),
  );
  if (r.new_user === true && !captcha) {
    await ctx.updateConnection({ pendingEmail: undefined });
    return {
      sent: false,
      reason: "not_registered",
      email,
      note: "No Wolt account exists for this address. Use the phone number on the account instead: account.requestSmsCode.",
    };
  }
  return {
    sent: true,
    email,
    includes_code: r.includes_code ?? null,
    new_user: r.new_user ?? null,
    note: "The email carries a login link and/or a numeric code. Submit the code with account.submitCode, or redeem the link with account.redeemLink.",
  };
}

/** What a phone number can log in with. Sends nothing. */
export async function loginMethods(ctx: ActionContext, phone: string) {
  await ensureIdentity(ctx);
  const normalized = normPhone(phone);
  const cfg = cfgOf(ctx);
  const operation = await authJson(ctx, "/v1/captcha/site_key", {
    operation: "start_phone_number_authentication_consumer",
    phone_number: normalized,
  }).catch(() => ({}) as Record<string, unknown>);
  const methods = await authJson(ctx, "/v1/wauth2/consumer-sms/login-methods", {
    phone_number: normalized,
    device_token: cfg.deviceToken,
    operation_token: pick(operation.operation_token),
  });
  return { phone: normalized, methods };
}

export async function requestSmsCode(
  ctx: ActionContext,
  input: {
    phone: string;
    emailToken?: string;
    email?: string;
    vnCaptcha?: string;
    smsCaptcha?: string;
    viaWhatsapp?: boolean;
  },
) {
  await ensureIdentity(ctx);
  const normalized = normPhone(input.phone);
  await ctx.updateConnection({ pendingPhone: normalized });
  const cfg = cfgOf(ctx);

  const operation = await authJson(ctx, "/v1/captcha/site_key", {
    operation: "start_phone_number_authentication_consumer",
    phone_number: normalized,
  }).catch(() => ({}) as Record<string, unknown>);
  const operationToken = pick(operation.operation_token);
  await ctx.updateConnection({ pendingOperationToken: operationToken });

  // The merge path: a magic-link token from any mailbox proves the email half,
  // which is what unlocks SMS on a social or phone-only account.
  const warnings: Warnings = [];
  const emailToken = input.emailToken
    ? linkToken(input.emailToken)
    : (cfg.pendingEmailToken ?? null);
  if (emailToken) {
    try {
      await authJson(
        ctx,
        "/v1/wauth2/consumer-sms/validate-number",
        {
          phone_number: normalized,
          email_token: emailToken,
          email: input.email ?? cfg.pendingEmail ?? undefined,
          use_new_response_format: true,
        },
        captchaHeader(input.vnCaptcha),
      );
      await ctx.updateConnection({ pendingEmailToken: emailToken });
    } catch (e) {
      warnings.push(
        `number validation failed (${(e as Error).message}); the SMS was still requested`,
      );
    }
  }

  await authJson(
    ctx,
    "/v2/wauth2/consumer-sms/start-phone-number-authentication",
    {
      phone_number: normalized,
      message_delivery_method: input.viaWhatsapp ? "whatsapp" : "sms",
      device_token: cfg.deviceToken,
      audience: AUDIENCE,
      capabilities: [CAPABILITIES],
      operation_token: operationToken,
    },
    captchaHeader(input.smsCaptcha),
  );
  return {
    sent: true,
    phone: normalized,
    via: input.viaWhatsapp ? "whatsapp" : "sms",
    warnings,
    next: "account.submitCode({ code })",
  };
}

/**
 * Submit the emailed or texted code.
 *
 * Wolt can answer with a second-factor escalation instead of a grant; that
 * arrives as a 4xx whose body carries the confirmation token, which is why the
 * error keeps its body privately.
 */
export async function submitCode(ctx: ActionContext, code: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.pendingEmail && !cfg.pendingPhone)
    throw new Error(
      "wolt: no login in progress — run account.requestEmailCode or account.requestSmsCode first",
    );
  try {
    const grant = cfg.pendingEmail
      ? await authForm(ctx, {
          grant_type: "email_login_code",
          email: cfg.pendingEmail,
          code,
          audience: AUDIENCE,
          device_token: cfg.deviceToken,
          capabilities: CAPABILITIES,
        })
      : await authForm(ctx, {
          grant_type: "phone_number_otp",
          phone_number: cfg.pendingPhone,
          otp: code,
          audience: AUDIENCE,
          device_token: cfg.deviceToken,
          capabilities: CAPABILITIES,
          tenant: "wolt",
        });
    return finish(ctx, grant);
  } catch (e) {
    if (!(e instanceof WoltError)) throw e;
    const escalation = pick(e.details().access_confirmation_token);
    if (!escalation) throw e;
    return startEmailConfirmation(ctx, escalation, e.details());
  }
}

/** The second factor: Wolt emails a code that confirms the escalated login. */
async function startEmailConfirmation(
  ctx: ActionContext,
  token: string,
  context: Record<string, unknown>,
) {
  await ctx.updateConnection({ pendingConfirmationToken: token });
  const bearer = { authorization: `Bearer ${token}` };
  const status = await http(AUTH, "/v1/access_confirmation/status", {
    method: "POST",
    web: false,
    body: {
      capabilities: [
        "email",
        "phone_number",
        "google",
        "facebook",
        "line",
        "emag",
        "strong_authentication",
        "kyc",
      ],
    },
    headers: { ...clientHeaders(cfgOf(ctx)), ...bearer },
  }).catch(() => ({}) as Record<string, unknown>);
  await http(AUTH, "/v1/access_confirmation/email", {
    method: "POST",
    web: false,
    body: "",
    headers: { ...clientHeaders(cfgOf(ctx)), ...bearer },
  });
  const methods = arr(status.methods).map(obj);
  return {
    connected: false,
    needs_confirmation: true,
    method: "email",
    account_first_name: pick(
      obj(context.access_confirmation_context).first_name,
    ),
    email_hint: pick(
      methods.find((m) => pick(m.method) === "email")?.masked_email,
    ),
    available_methods: methods
      .map((m) => pick(m.method))
      .filter((m): m is string => m !== null),
    next: "account.submitConfirmation({ code })",
  };
}

export async function submitConfirmation(ctx: ActionContext, code: string) {
  const cfg = cfgOf(ctx);
  if (!cfg.pendingConfirmationToken)
    throw new Error(
      "wolt: no confirmation in progress — account.submitCode reports when one is needed",
    );
  await http(AUTH, "/v1/access_confirmation/email/submit", {
    method: "POST",
    web: false,
    body: { code },
    headers: {
      ...clientHeaders(cfg),
      authorization: `Bearer ${cfg.pendingConfirmationToken}`,
    },
  });
  const grant = await authForm(ctx, {
    grant_type: "access_confirmation_token",
    access_confirmation_token: cfg.pendingConfirmationToken,
    audience: AUDIENCE,
    device_token: cfg.deviceToken,
  });
  return finish(ctx, grant);
}

// ---------- what a session knows ----------

/** The id shape varies by endpoint: a bare string, or a wrapped $uuid/$oid. */
function methodId(raw: unknown): string | null {
  const method = obj(raw);
  const id = method.id;
  if (typeof id === "object" && id !== null)
    return pick(obj(id).$uuid, obj(id).$oid);
  return pick(id, method.card_id);
}

export async function discoverPaymentMethod(
  ctx: ActionContext,
): Promise<string | null> {
  const sources: Array<[string, string]> = [
    [RESTAURANT, "/v3/user/me/payment_methods"],
    [CONSUMER, "/order-xp/v1/payment-methods"],
  ];
  let lastError: Error | null = null;
  for (const [host, path] of sources) {
    try {
      const r = await authed(ctx, host, path);
      const results = obj(r.results);
      const list = [
        ...arr(results.cards),
        ...arr(results.payment_methods),
        ...arr(r.results),
        ...arr(r.payment_methods),
        ...arr(r.methods),
      ];
      const usable =
        list.find((m) => obj(m).valid_for_payments === true && methodId(m)) ??
        list.find((m) => methodId(m));
      const id = methodId(usable);
      if (id) {
        await ctx.updateConnection({ paymentMethodId: id });
        return id;
      }
    } catch (e) {
      lastError = e as Error;
    }
  }
  // Every source failed, as opposed to every source answering "no card".
  if (lastError) throw lastError;
  return null;
}

export interface Address {
  id: string | null;
  alias: string | null;
  address: string | null;
  city: string | null;
  street: string | null;
  apartment: string | null;
  coordinates: number[] | null;
  is_verified: boolean | null;
}

function coordinatesOf(location: Record<string, unknown>): number[] | null {
  const google = arr(obj(obj(location.google_place_coordinates).coordinates));
  const user = arr(obj(obj(location.user_coordinates).coordinates));
  const source = google.length ? google : user;
  const numbers = source
    .map((c) => (typeof c === "number" ? c : null))
    .filter((c): c is number => c !== null);
  return numbers.length === 2 ? numbers : null;
}

export async function listAddresses(ctx: ActionContext): Promise<Address[]> {
  const r = await authed(ctx, RESTAURANT, "/v2/delivery/info");
  return arr(r.results).map((raw) => {
    const a = obj(raw);
    const location = obj(a.location);
    return {
      id: pick(a.id),
      alias: pick(a.alias),
      address: pick(location.address),
      city: pick(location.city),
      street: pick(location.street),
      apartment: pick(location.apartment),
      coordinates: coordinatesOf(location),
      is_verified: typeof a.is_verified === "boolean" ? a.is_verified : null,
    };
  });
}

export function selectAddress(list: Address[], wanted?: string): Address {
  if (!list.length)
    throw new Error(
      "wolt: no saved delivery address on the account — add one in the Wolt app first",
    );
  if (!wanted) return list[0];
  const found = list.find((a) => a.id === wanted);
  if (!found) throw new Error(`wolt: address ${wanted} is not on this account`);
  return found;
}

export async function whoami(ctx: ActionContext) {
  const me = await authed(ctx, RESTAURANT, "/v1/user/me");
  const user = obj(me.user);
  return {
    id: pick(obj(user._id).$oid),
    name: pick(user.name),
    saved_addresses: (await listAddresses(ctx)).length,
    payment_method: cfgOf(ctx).paymentMethodId ?? null,
  };
}

/** Local view of the connection. No network, so it answers on a broken session. */
export function status(ctx: ActionContext) {
  const cfg: Cfg = cfgOf(ctx);
  const missing: string[] = [];
  if (!cfg.refreshToken) missing.push("refreshToken (owner login)");
  if (!cfg.paymentMethodId) missing.push("paymentMethodId (saved card)");
  return {
    connected: !!cfg.refreshToken,
    orderingEnabled: cfg.allowOrdering === true,
    paymentMethod: cfg.paymentMethodId ?? null,
    pendingLogin: cfg.pendingEmail ?? cfg.pendingPhone ?? null,
    pendingConfirmation: !!cfg.pendingConfirmationToken,
    missing,
  };
}
