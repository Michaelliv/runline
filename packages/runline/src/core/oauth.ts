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
import {
  buildOAuth2AuthorizationUrl,
  exchangeOAuth2Code,
} from "../auth/oauth2.js";
import type { OAuth2Definition, OAuthTokens } from "../auth/types.js";
import type { OAuthConfig } from "../plugin/types.js";

export type { OAuthTokens } from "../auth/types.js";

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

export interface RunOAuthOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Called with the consent URL before the browser is opened.
   * Lets the CLI print a clickable link in case auto-open fails.
   */
  onAuthUrl?: (url: string) => void | Promise<void>;
  /** Override the browser launcher. Defaults to OS-appropriate command. */
  openBrowser?: (url: string) => void | Promise<void>;
  /** Maximum wait for browser consent. Defaults to five minutes. */
  callbackTimeoutMs?: number;
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

/** Plugin OAuth declarations retain their body-auth default at the compatibility boundary. */
function definition(config: OAuthConfig): OAuth2Definition {
  return {
    id: "plugin-oauth",
    provider: "legacy",
    authorization: { url: config.authUrl, parameters: config.authParams },
    exchange: {
      url: config.tokenUrl,
      clientAuthentication: "client_secret_post",
    },
  };
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
  return buildOAuth2AuthorizationUrl(definition(config), {
    application: { clientId: opts.clientId },
    redirectUri: opts.redirectUri,
    state: opts.state,
    scopes: config.scopes,
    pkceChallenge: opts.pkceChallenge,
  });
}

/**
 * Exchange an authorization code using the shared OAuth2 protocol runtime.
 * Refresh tokens and expiry are optional provider capabilities.
 */
export async function exchangeAuthCode(
  config: OAuthConfig,
  opts: ExchangeCodeOptions,
): Promise<OAuthTokens> {
  return exchangeOAuth2Code(definition(config), {
    application: { clientId: opts.clientId, clientSecret: opts.clientSecret },
    code: opts.code,
    redirectUri: opts.redirectUri,
    codeVerifier: opts.codeVerifier,
  });
}

// ─── End-to-end CLI flow ─────────────────────────────────────────

/**
 * Run the full OAuth2 authorization-code flow end-to-end.
 * Resolves with the exchanged tokens once the user completes the
 * browser consent and the token endpoint returns a valid access token.
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

  const { code } = await captureCode(
    OAUTH_CALLBACK_PORT,
    state,
    async () => {
      // Publish consent only after the callback listener is ready.
      if (options.onAuthUrl) await options.onAuthUrl(authUrl);
      else console.error(`Open this URL to authorize:\n  ${authUrl}`);
      await (options.openBrowser ?? defaultOpenBrowser)(authUrl);
    },
    options.callbackTimeoutMs ?? 300_000,
  );
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
  onReady: () => Promise<void>,
  timeoutMs: number,
): Promise<{ code: string }> {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2 ** 31 - 1
  ) {
    return Promise.reject(new Error("OAuth: invalid callback timeout"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: { code: string } | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      } catch {
        res.writeHead(400).end("Invalid callback");
        return;
      }
      if (req.method !== "GET" || url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      // Unauthenticated callbacks cannot cancel or complete a pending flow.
      if (
        settled ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== expectedState
      ) {
        res.writeHead(400).end("State mismatch");
        return;
      }
      if (url.searchParams.has("error")) {
        res.writeHead(400).end("Authorization denied. You can close this tab.");
        finish(new Error("OAuth: authorization denied"));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.getAll("code").length !== 1) {
        res.writeHead(400).end("Missing or ambiguous code");
        return;
      }
      res.end(
        "Authorization received. Return to your terminal for the connection result.",
      );
      finish({ code });
    });
    const timer = setTimeout(
      () => finish(new Error("OAuth: browser consent timed out")),
      timeoutMs,
    );
    server.once("error", () =>
      finish(new Error("OAuth: callback listener unavailable")),
    );
    server.listen(port, "127.0.0.1", () => {
      if (settled) return;
      void onReady().catch(() =>
        finish(new Error("OAuth: browser launch failed")),
      );
    });
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
