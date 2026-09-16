import type { TSchema } from "typebox";
import type { ConnectionUpdate } from "../connections/types.js";

export interface InputField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
}

export type LegacyInputSchema = Record<string, InputField>;
export type TypedInputSchema = TSchema;
export type InputSchema = LegacyInputSchema | TypedInputSchema;

export interface ConnectionSchemaField {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  env?: string;
}

export type LegacyConnectionSchema = Record<string, ConnectionSchemaField>;
export type ConnectionSchema = LegacyConnectionSchema | TSchema;

export interface HelpInput {
  type: string;
  displayType?: string;
  required: boolean;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  /** Element shape, for array inputs. */
  items?: HelpInput;
  /** Nested field shapes, for object inputs. */
  properties?: Record<string, HelpInput>;
  /**
   * Branches of a union, where at least one carries shape the display
   * type cannot express. Absent for unions of literals or bare scalars.
   */
  variants?: HelpInput[];
  /** Set when nesting ran past the describe depth limit and was not read. */
  truncated?: boolean;
}

export type ActionAccess = "read" | "write";

export interface ActionDef {
  name: string;
  access?: ActionAccess;
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
  /**
   * Opaque per-run value from the embedder's `execute()` options.
   * Host-supplied and invisible to worker code, so actions may
   * derive authority from it (e.g. per-call identity on a shared
   * engine). Absent when the embedder passed none.
   */
  context?: unknown;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  /**
   * Persist a shallow config patch through the host's connection provider.
   * For token refresh, pass an async updater: it receives freshly read config
   * under update ownership, so the provider coordinates the whole refresh.
   * Return undefined to reuse a token refreshed by another caller.
   *
   * This action's snapshot changes only after a successful store update.
   * A patch alone serializes the write, not any preceding network request.
   */
  updateConnection(change: ConnectionUpdate): Promise<void>;
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
  connectionConfigSchema?: ConnectionSchema;
  /** OAuth2 config for `runline auth <plugin>`. */
  oauth?: OAuthConfig;
  /** @internal */
  initHooks?: Array<(config: Record<string, unknown>) => void>;
}
