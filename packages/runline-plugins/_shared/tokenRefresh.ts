import {
  requestOAuth2Token,
  type ActionContext,
  type OAuth2TokenEndpoint,
  type OAuthApplication,
} from "runline";

const REFRESH_SKEW_MS = 60_000;

type TokenPatch = {
  accessToken: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
};

function usableToken(
  config: Readonly<Record<string, unknown>>,
): string | undefined {
  return typeof config.accessToken === "string" &&
    config.accessToken &&
    (config.accessTokenExpiresAt === undefined ||
      (typeof config.accessTokenExpiresAt === "number" &&
        Number.isFinite(config.accessTokenExpiresAt) &&
        Date.now() < config.accessTokenExpiresAt - REFRESH_SKEW_MS))
    ? config.accessToken
    : undefined;
}

/** Refresh ownership includes the provider request and persistence of rotated tokens. */
export async function coordinatedAccessToken(
  ctx: ActionContext,
  refresh: (current: Readonly<Record<string, unknown>>) => Promise<TokenPatch>,
  /** Renew even when the stored token is still usable, to prove it or to rotate it. */
  force = false,
): Promise<string> {
  const cached = force ? undefined : usableToken(ctx.connection.config);
  if (cached) return cached;
  await ctx.updateConnection(async (current) => {
    if (!force && usableToken(current)) return;
    return refresh(current);
  });
  const token = ctx.connection.config.accessToken;
  if (typeof token !== "string" || !token)
    throw new Error("Token refresh committed no access token");
  return token;
}

/** Token errors exclude response bodies, parser diagnostics, and request credentials. */
export async function requestToken(
  endpoint: OAuth2TokenEndpoint,
  body: Record<string, string>,
  application?: OAuthApplication,
): Promise<TokenPatch> {
  const tokens = await requestOAuth2Token(endpoint, body, application);
  return {
    accessToken: tokens.accessToken,
    // Unknown expiry replaces an old expiry; it never inherits a stale timestamp.
    accessTokenExpiresAt: tokens.expiresAt,
    ...(tokens.refreshToken === undefined
      ? {}
      : { refreshToken: tokens.refreshToken }),
  };
}
