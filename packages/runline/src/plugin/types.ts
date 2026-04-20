export interface InputField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
}

export type InputSchema = Record<string, InputField>;

export interface ActionDef {
  name: string;
  description?: string;
  inputSchema?: InputSchema;
  execute: (input: unknown, ctx: ActionContext) => unknown | Promise<unknown>;
}

export interface ConnectionConfig {
  name: string;
  plugin: string;
  config: Record<string, unknown>;
}

export interface ActionContext {
  connection: ConnectionConfig;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  /**
   * Merge a partial config patch into the current connection,
   * persisting it atomically to `.runline/config.json`.
   *
   * Intended for plugins that refresh credentials at runtime
   * (OAuth access tokens, rotating API keys). The write is
   * guarded by a file lock, so concurrent `runline exec`
   * processes refreshing the same connection won't race.
   *
   * In-memory `ctx.connection.config` is also mutated so the
   * rest of the current action sees the new values.
   */
  updateConnection(patch: Record<string, unknown>): Promise<void>;
}

/**
 * OAuth2 authorization-code configuration declared by a plugin.
 * Consumed by the generic `runline auth <plugin>` flow, which
 * handles the browser redirect, code exchange, and persistence
 * of `clientId`, `clientSecret`, `refreshToken`, `accessToken`,
 * and `accessTokenExpiresAt` into the plugin's connection.
 */
export interface OAuthConfig {
  /** Authorization endpoint, e.g. https://accounts.google.com/o/oauth2/v2/auth */
  authUrl: string;
  /** Token endpoint, e.g. https://oauth2.googleapis.com/token */
  tokenUrl: string;
  /** Scopes to request on the consent screen. */
  scopes: string[];
  /**
   * Extra query parameters on the auth URL. Used for provider-
   * specific knobs like Google's `access_type=offline` and
   * `prompt=consent` (both required to get a refresh token back).
   */
  authParams?: Record<string, string>;
  /**
   * Printed by `runline auth <plugin>` before credentials are
   * requested. Each array entry is a line. The token
   * `{{redirectUri}}` is substituted with the actual callback URL
   * the plugin will use, so users can register it verbatim with
   * the provider (e.g. in Google Cloud Console).
   *
   * Omit for plugins where client credentials come from the
   * provider's partner program and no user setup is needed.
   */
  setupHelp?: string[];
}

export interface PluginDef {
  name: string;
  version: string;
  actions: ActionDef[];
  connectionConfigSchema?: Record<
    string,
    {
      type: string;
      required?: boolean;
      description?: string;
      default?: unknown;
      env?: string;
    }
  >;
  /** OAuth2 config for `runline auth <plugin>`. */
  oauth?: OAuthConfig;
  /** @internal */
  initHooks?: Array<(config: Record<string, unknown>) => void>;
}
