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
  OAuthOperation,
  OAuthRuntimeOptions,
  OAuthTokens,
} from "./types.js";

function required(value: string): string {
  if (typeof value !== "string" || !value)
    throw new AuthError("invalid_credentials");
  return value;
}

/** Redirect registration and state custody belong to the host's setup lifecycle. */
export function buildOAuth2AuthorizationUrl(
  definition: OAuth2Definition,
  options: OAuthAuthorizationOptions,
): string {
  if (!definition.authorization) throw new AuthError("unsupported_operation");
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
  const fields: Record<string, string> = {
    code: required(input.code),
    redirect_uri: required(input.redirectUri),
  };
  if (input.codeVerifier !== undefined)
    fields.code_verifier = required(input.codeVerifier);
  return operate(definition, "exchange", input.application, fields, options);
}

/** Call under host update ownership. An omitted replacement refresh token preserves the grant. */
export async function refreshOAuth2Token(
  definition: OAuth2Definition,
  input: {
    application?: OAuthApplication;
    tokens: OAuthTokens;
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
