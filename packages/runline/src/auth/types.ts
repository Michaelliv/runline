/** Provider protocol metadata. Hosts approve definitions independently of workspace code. */
export interface OAuth2Definition {
  id: string;
  provider: string;
  authorization?: {
    url: string;
    parameters?: Record<string, string>;
  };
  exchange?: OAuth2TokenEndpoint;
  refresh?: OAuth2TokenEndpoint;
  clientCredentials?: OAuth2TokenEndpoint;
}

/** Each operation can use a different endpoint, encoding, and client authentication. */
export interface OAuth2TokenEndpoint {
  url: string;
  clientAuthentication:
    | "none"
    | "client_id"
    | "client_secret_basic"
    | "client_secret_post";
  encoding?: "form" | "json";
  /** Omitted uses the operation's standard grant; null omits grant_type entirely. */
  grantType?: string | null;
  /** Provider-specific fields; cannot replace protocol-owned parameters. */
  parameters?: Record<string, string>;
  response?: {
    /** Path to a token object inside a provider envelope. No expression evaluation. */
    path?: string[];
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: string;
    tokenType?: string;
    scope?: string;
    /** Explicitly retained provider fields, e.g. an account's API instance URL. */
    metadata?: Record<string, string>;
  };
}

/** Selected by the host, never embedded in a provider definition. */
export interface OAuthApplication {
  clientId: string;
  clientSecret?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since epoch. Missing means unknown, not already expired. */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  /** Only fields explicitly selected by the definition's response mapping. */
  metadata?: Record<string, string>;
}

export type OAuthOperation = "exchange" | "refresh" | "clientCredentials";

/** Protocol events report issuance, never durability. They contain no credential data. */
export interface OAuthEvent {
  definition: string;
  provider: string;
  operation: OAuthOperation;
  outcome: "issued" | "failed";
  code?: import("./errors.js").AuthErrorCode;
}

export interface OAuthRuntimeOptions {
  /** Host transport hook for egress/SSRF enforcement. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  /** Positive integer milliseconds, at most 120 seconds. Defaults to 20 seconds. */
  timeoutMs?: number;
  /** Observer failures cannot turn an issued rotating token into a failed exchange. */
  onEvent?: (event: OAuthEvent) => void | Promise<void>;
}

export interface OAuthAuthorizationOptions {
  application: OAuthApplication;
  redirectUri: string;
  state: string;
  scopes?: string[];
  pkceChallenge?: string;
}

export interface OAuthCodeOptions {
  application: OAuthApplication;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}
