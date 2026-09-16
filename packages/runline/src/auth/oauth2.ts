import { createPrivateKey, sign } from "node:crypto";
import { notifyObserver } from "../utils/observer.js";
import { AuthError } from "./errors.js";
import {
  oauthEndpoint,
  providerParameters,
  requestOAuth2Token,
} from "./token.js";
import type {
  OAuth2Definition,
  OAuthApplication,
  OAuthAuthorizationOptions,
  OAuthCodeOptions,
  OAuthJwtIdentity,
  OAuthOperation,
  OAuthRuntimeOptions,
  OAuthTokens,
} from "./types.js";

function required(value: string): string {
  if (typeof value !== "string" || !value)
    throw new AuthError("invalid_credentials");
  return value;
}

/** Shared by definition registration and both setup primitives; no truthy coercion. */
export function validateOAuth2ExchangePolicy(
  endpoint: OAuth2Definition["exchange"],
): void {
  for (const key of ["sendState", "requirePkce"] as const) {
    if (endpoint?.[key] !== undefined && typeof endpoint[key] !== "boolean")
      throw new AuthError("invalid_definition");
  }
}

/** Redirect registration and state custody belong to the host's setup lifecycle. */
export function buildOAuth2AuthorizationUrl(
  definition: OAuth2Definition,
  options: OAuthAuthorizationOptions,
): string {
  validateOAuth2ExchangePolicy(definition.exchange);
  if (!definition.authorization) throw new AuthError("unsupported_operation");
  if (definition.exchange?.requirePkce && !options.pkceChallenge)
    throw new AuthError("invalid_credentials");
  const url = oauthEndpoint(definition.authorization.url);
  const parameters = providerParameters(definition.authorization.parameters);
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value);
  url.searchParams.set("client_id", required(options.application.clientId));
  url.searchParams.set("redirect_uri", required(options.redirectUri));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", required(options.state));
  if (options.scopes?.length)
    url.searchParams.set("scope", options.scopes.join(" "));
  if (options.pkceChallenge !== undefined) {
    url.searchParams.set("code_challenge", required(options.pkceChallenge));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

async function operate(
  definition: OAuth2Definition,
  operation: OAuthOperation,
  application: OAuthApplication | undefined,
  parameters: Record<string, string>,
  options: OAuthRuntimeOptions,
): Promise<OAuthTokens> {
  const event = {
    definition: definition.id,
    provider: definition.provider,
    operation,
  };
  try {
    const configured = definition[operation];
    if (!configured) throw new AuthError("unsupported_operation");
    const standard = {
      exchange: "authorization_code",
      refresh: "refresh_token",
      clientCredentials: "client_credentials",
      jwtBearer: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    };
    const tokens = await requestOAuth2Token(
      configured,
      { ...parameters, grant_type: standard[operation] },
      application,
      options,
    );
    notifyObserver(options.onEvent, { ...event, outcome: "issued" });
    return tokens;
  } catch (error) {
    const safe =
      error instanceof AuthError ? error : new AuthError("invalid_definition");
    notifyObserver(options.onEvent, {
      ...event,
      outcome: "failed",
      code: safe.code,
    });
    throw safe;
  }
}

export async function exchangeOAuth2Code(
  definition: OAuth2Definition,
  input: OAuthCodeOptions,
  options: OAuthRuntimeOptions = {},
): Promise<OAuthTokens> {
  validateOAuth2ExchangePolicy(definition.exchange);
  const fields: Record<string, string> = {
    code: required(input.code),
    redirect_uri: required(input.redirectUri),
  };
  if (definition.exchange?.requirePkce || input.codeVerifier !== undefined)
    fields.code_verifier = required(input.codeVerifier ?? "");
  if (definition.exchange?.sendState)
    fields.state = required(input.state ?? "");
  return operate(definition, "exchange", input.application, fields, options);
}

/** Call under host update ownership. An omitted replacement refresh token preserves the grant. */
export async function refreshOAuth2Token(
  definition: OAuth2Definition,
  input: {
    application?: OAuthApplication;
    tokens: Partial<OAuthTokens>;
    scopes?: string[];
  },
  options: OAuthRuntimeOptions = {},
): Promise<OAuthTokens> {
  const refreshToken = required(input.tokens.refreshToken ?? "");
  const scope = input.tokens.scope;
  const tokenType = input.tokens.tokenType;
  const metadata = structuredClone(input.tokens.metadata);
  const next = await operate(
    definition,
    "refresh",
    input.application,
    {
      refresh_token: refreshToken,
      ...(input.scopes?.length ? { scope: input.scopes.join(" ") } : {}),
    },
    options,
  );
  // Expiry belongs to the new access token and is never inherited from the old one.
  return {
    ...(scope === undefined ? {} : { scope }),
    ...(tokenType === undefined ? {} : { tokenType }),
    refreshToken,
    ...next,
    ...(metadata || next.metadata
      ? { metadata: { ...metadata, ...next.metadata } }
      : {}),
  };
}

/** Fixed RS256 assertion protocol; no caller-defined signer or executable credential hook. */
export async function acquireOAuth2JwtToken(
  definition: OAuth2Definition,
  input: { identity: OAuthJwtIdentity; scopes: string[] },
  options: OAuthRuntimeOptions = {},
): Promise<OAuthTokens> {
  const endpoint = definition.jwtBearer;
  if (!endpoint) throw new AuthError("unsupported_operation");
  const audience = oauthEndpoint(endpoint.url).toString();
  if (
    endpoint.clientAuthentication !== "none" ||
    endpoint.grantType !== undefined
  )
    throw new AuthError("invalid_definition");
  let assertion: string;
  let now: number;
  try {
    now = (options.now ?? Date.now)();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      now > Number.MAX_SAFE_INTEGER - 3_600_000
    )
      throw new Error();
    if (
      !Array.isArray(input.scopes) ||
      !input.scopes.length ||
      input.scopes.some(
        (scope) => typeof scope !== "string" || !scope || /\s/.test(scope),
      )
    )
      throw new Error();
    const identity = input.identity;
    required(identity.issuer);
    if (identity.subject !== undefined) required(identity.subject);
    if (
      typeof identity.privateKey !== "string" ||
      identity.privateKey.length > 65_536
    )
      throw new Error();
    const key = createPrivateKey(identity.privateKey);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error();
    const iat = Math.floor(now / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: identity.issuer,
      aud: audience,
      scope: input.scopes.join(" "),
      iat,
      exp: iat + 3600,
      ...(identity.subject === undefined ? {} : { sub: identity.subject }),
    })}`;
    assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
  } catch {
    throw new AuthError("invalid_credentials");
  }
  return operate(
    definition,
    "jwtBearer",
    undefined,
    { assertion },
    { ...options, now: () => now },
  );
}

export async function acquireOAuth2ClientToken(
  definition: OAuth2Definition,
  input: { application: OAuthApplication; scopes?: string[] },
  options: OAuthRuntimeOptions = {},
): Promise<OAuthTokens> {
  return operate(
    definition,
    "clientCredentials",
    input.application,
    input.scopes?.length ? { scope: input.scopes.join(" ") } : {},
    options,
  );
}
