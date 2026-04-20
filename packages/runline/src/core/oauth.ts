/**
 * Generic OAuth2 authorization-code flow.
 *
 * Two surfaces:
 *
 * 1. `runOAuth(config, {clientId, clientSecret})` — end-to-end CLI
 *    flow. Opens the browser, captures the redirect on a pinned
 *    localhost port, exchanges the code, returns tokens. Used by
 *    `runline auth <plugin>`.
 *
 * 2. Primitives for callers that can't run a local callback server
 *    (hosted apps, GUIs, anywhere the user's browser doesn't talk
 *    back to the process driving the flow):
 *
 *      - `generatePKCE()` — S256 verifier + challenge
 *      - `buildAuthUrl(config, opts)` — assemble the consent URL
 *      - `exchangeAuthCode(config, opts)` — POST to the token
 *        endpoint, get back tokens
 *
 *    The caller orchestrates: generates state + PKCE, builds the
 *    URL, shows it to the user, receives the code back however it
 *    wants (redirect-URI paste, browser popup with postMessage,
 *    public HTTPS callback, …), calls exchangeAuthCode.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { OAuthConfig } from "../plugin/types.js";

/**
 * Fixed callback port for OAuth redirects. Pinned so users can
 * register `http://127.0.0.1:<PORT>/callback` once with the
 * provider and have it keep working across every `runline auth`
 * invocation. Override via `RUNLINE_OAUTH_CALLBACK_PORT` if you
 * need a different port (you'll have to re-register the redirect
 * URI with the provider after changing it).
 */
export const OAUTH_CALLBACK_PORT: number = (() => {
  const raw = process.env.RUNLINE_OAUTH_CALLBACK_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return 47823;
})();

/** Canonical localhost redirect URI for CLI-based flows. */
export const OAUTH_CALLBACK_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since epoch. */
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}

export interface RunOAuthOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Called with the consent URL before the browser is opened.
   * Lets the CLI print a clickable link in case auto-open fails.
   */
  onAuthUrl?: (url: string) => void;
  /** Override the browser launcher. Defaults to OS-appropriate command. */
  openBrowser?: (url: string) => void;
}

export interface BuildAuthUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  /** S256 code challenge. Pass alongside a verifier kept by the driver. */
  pkceChallenge?: string;
}

export interface ExchangeCodeOptions {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  /** PKCE verifier matching the challenge sent on the auth URL. */
  codeVerifier?: string;
}

export interface PKCEPair {
  verifier: string;
  /** Base64url SHA-256 of the verifier, for `code_challenge_method=S256`. */
  challenge: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

// ─── Primitives ──────────────────────────────────────────────────

/**
 * Generate a PKCE verifier and its SHA-256 challenge. The verifier
 * stays with the driver until the token exchange; the challenge
 * goes on the auth URL.
 */
export function generatePKCE(): PKCEPair {
  const verifier = base64urlEncode(randomBytes(32));
  const challenge = base64urlEncode(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

/**
 * Assemble the authorization URL for a plugin's OAuth config.
 * Pass `pkceChallenge` to include PKCE; omit for plain auth-code.
 */
export function buildAuthUrl(
  config: OAuthConfig,
  opts: BuildAuthUrlOptions,
): string {
  const url = new URL(config.authUrl);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", opts.state);
  if (opts.pkceChallenge) {
    url.searchParams.set("code_challenge", opts.pkceChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(config.authParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Exchange an authorization code for tokens. Throws if the
 * provider doesn't return a refresh_token — that's almost always a
 * misconfiguration (e.g. missing `access_type=offline` for Google).
 */
export async function exchangeAuthCode(
  config: OAuthConfig,
  opts: ExchangeCodeOptions,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  if (opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `OAuth: token exchange failed (${res.status}): ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.refresh_token) {
    throw new Error(
      "OAuth: provider did not return a refresh token. This usually means a prior consent is cached — revoke access with the provider and retry. For Google, set authParams: { access_type: 'offline', prompt: 'consent' }.",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

// ─── End-to-end CLI flow ─────────────────────────────────────────

/**
 * Run the full OAuth2 authorization-code flow end-to-end.
 * Resolves with the exchanged tokens once the user completes the
 * browser consent and the token endpoint returns a refresh token.
 *
 * Uses the pinned localhost callback port. If you can't run a
 * local callback server, drive the flow yourself with
 * `buildAuthUrl` + `exchangeAuthCode`.
 */
export async function runOAuth(
  config: OAuthConfig,
  options: RunOAuthOptions,
): Promise<OAuthTokens> {
  const redirectUri = OAUTH_CALLBACK_URI;
  const state = randomState();
  const { verifier, challenge } = generatePKCE();

  const authUrl = buildAuthUrl(config, {
    clientId: options.clientId,
    redirectUri,
    state,
    pkceChallenge: challenge,
  });

  // Always make the URL visible. `onAuthUrl` is the preferred
  // channel (CLI formats it inline); if absent, fall back to
  // stderr so headless invocations (SSH, CI) aren't left waiting
  // on a browser that never opens.
  if (options.onAuthUrl) {
    options.onAuthUrl(authUrl);
  } else {
    console.error(`Open this URL to authorize:\n  ${authUrl}`);
  }
  const open = options.openBrowser ?? defaultOpenBrowser;
  open(authUrl);

  const { code } = await captureCode(OAUTH_CALLBACK_PORT, state);
  return exchangeAuthCode(config, {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    code,
    redirectUri,
    codeVerifier: verifier,
  });
}

// ─── Local callback server ───────────────────────────────────────

function captureCode(
  port: number,
  expectedState: string,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth: ${error}`));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end("Missing code");
        return;
      }
      if (state !== expectedState) {
        res.statusCode = 400;
        res.end("State mismatch — possible CSRF. Aborting.");
        server.close();
        reject(new Error("OAuth: state mismatch"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Connected</title>` +
          `<body style="font-family:system-ui;padding:2rem">` +
          `<h1 style="margin:0 0 0.5rem">Connected \u2713</h1>` +
          `<p style="color:#666">You can close this tab and return to your terminal.</p>`,
      );
      server.close();
      resolve({ code });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

function randomState(): string {
  return base64urlEncode(randomBytes(16));
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function defaultOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const proc = spawn(cmd, [url], {
    stdio: "ignore",
    detached: true,
  });
  proc.on("error", () => {
    // Browser failed to open — caller's onAuthUrl prints the URL
    // so the user can paste it manually.
  });
  proc.unref();
}
