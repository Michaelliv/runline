import type { PluginFunction } from "../../plugin/api.js";

/**
 * One migrated plugin, exercised by credential-plugins.test.ts: an action
 * run once through a host broker with a secret-free connection, and once
 * through the local signer with the flat CLI config it has always used.
 * Every plugin that declares a credential has exactly one fixture here.
 */
export interface CredentialFixture {
  plugin: PluginFunction;
  /** The plugin's registered name. */
  name: string;
  /** Flat CLI connection config: public fields plus the secrets below. */
  config: Record<string, unknown>;
  /** Config fields holding secrets; the brokered run has none of them. */
  secrets: string[];
  action: string;
  input: Record<string, unknown>;
  /** Answer to every request the action makes. */
  response: unknown;
  /** Target the action's first request names. */
  target: string;
  /**
   * The first request's wire shape under the local signer — the same
   * destination and auth header the plugin sent before it was brokered.
   * A query key appears in `url`.
   */
  wire: { url: string; header?: [name: string, value: string] };
}
