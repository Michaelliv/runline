import type {
  ConnectionConfig,
  ConnectionSchema,
  PluginSourceInfo,
} from "../plugin/types.js";

export type ConnectionPatch = Record<string, unknown>;

/**
 * Runs once under the adapter's update ownership, against freshly read state.
 * Return a shallow config patch, or undefined to keep the current state.
 * May perform a token refresh. Must not recursively update the same store.
 * A thrown error aborts the write; adapters must not automatically replay it.
 */
export type ConnectionUpdater = (
  current: Readonly<Record<string, unknown>>,
) => ConnectionPatch | undefined | Promise<ConnectionPatch | undefined>;

export type ConnectionUpdate = ConnectionPatch | ConnectionUpdater;

export interface ConnectionRequest {
  plugin: string;
  /**
   * The asking plugin's owner (`PluginSourceInfo.owner`), when discovery
   * knows it. A provider stamps it on a connection it creates for the call.
   */
  owner?: string;
  action?: string;
  schema?: ConnectionSchema;
  /** Host-supplied per-execution authority, never action input. */
  context?: unknown;
}

/**
 * An adapter-owned binding to one resolved connection. Read and update must
 * target that same identity even when other callers resolve different accounts.
 * Returned snapshots must not alias authoritative storage.
 */
export interface ConnectionHandle {
  read(): Promise<ConnectionConfig>;
  /**
   * Acquire ownership, re-read, run the updater, persist, then return the committed
   * snapshot. Ownership spans the updater's async work, not just the final write.
   * Coordinate across every writer sharing this storage; fail closed on failure
   * to acquire ownership. Do not recreate a deleted connection. The host must
   * fence lifecycle changes (disconnect/reconnect) against stale refreshes.
   *
   * This is not a distributed transaction with the remote provider: a provider
   * may rotate a token before a write fails. Surface that failure; never silently
   * report the replacement token as durably saved or replay the callback.
   */
  update(change: ConnectionUpdate): Promise<ConnectionConfig>;
  /**
   * An action that acted through this connection threw: its error, with an
   * Error in place of a nullish throw. Whether the failure is the
   * connection's own (its provider refusing the credential) is the host's
   * to judge, from the error and the identity this handle holds. Called at
   * most once per action call, once its execute has rejected, so after every
   * `update` the call awaited. The call never waits on it, and a throw or
   * rejection here is swallowed.
   */
  failed?(error: unknown): void | Promise<void>;
}

/**
 * Trusted-host integration seam. Resolve and authorize on each action invocation;
 * rejection never falls back to environment variables or local files.
 * These handles are for trusted plugin code, not a security boundary for arbitrary
 * code. A broker for untrusted plugins must expose constrained requests instead.
 */
export interface ConnectionProvider {
  resolve(request: ConnectionRequest): Promise<ConnectionHandle>;
}

/**
 * Refuse a connection that belongs to another plugin source. A connection
 * is bound to the owner it was made for: a plugin of the same name from
 * elsewhere does not inherit it, and a package's plugin only uses
 * connections made for that package. Plugins with no known owner (a host
 * that constructs or loads them itself) are not checked.
 */
export function assertConnectionOwner(
  connection: ConnectionConfig,
  plugin: { name: string; sourceInfo?: PluginSourceInfo },
): void {
  const info = plugin.sourceInfo;
  if (!info) return;
  if (connection.owner === info.owner) return;
  if (connection.owner === undefined && info.origin !== "package") return;
  throw new Error(
    `Connection "${connection.name}" was made for ${
      connection.owner === undefined
        ? "a bundled or local plugin"
        : describeOwner(connection.owner)
    }, not for plugin "${plugin.name}" from ${describeOwner(info.owner)}. Add a connection for this plugin to use it.`,
  );
}

/**
 * The connection a request resolves to, of those stored for its plugin: one
 * made for the asking owner, else the first. `assertConnectionOwner` then
 * decides whether the plugin may use it.
 */
export function connectionFor<T extends ConnectionConfig>(
  stored: T[],
  request: ConnectionRequest,
): T | undefined {
  const forPlugin = stored.filter((entry) => entry.plugin === request.plugin);
  return (
    forPlugin.find((entry) => entry.owner === request.owner) ?? forPlugin[0]
  );
}

/** The owner a connection created for this request carries, when one is known. */
export function ownedBy(request: ConnectionRequest): { owner?: string } {
  return request.owner === undefined ? {} : { owner: request.owner };
}

function describeOwner(owner: string): string {
  if (owner === "builtin") return "the bundled plugin";
  if (owner === "local") return "a local plugin";
  return `package ${owner}`;
}

export async function connectionPatch(
  change: ConnectionUpdate,
  current: Record<string, unknown>,
): Promise<ConnectionPatch | undefined> {
  const patch =
    typeof change === "function"
      ? await change(structuredClone(current))
      : change;
  if (
    patch !== undefined &&
    (patch === null || typeof patch !== "object" || Array.isArray(patch))
  ) {
    throw new Error(
      "Connection update must return an object patch or undefined",
    );
  }
  return patch === undefined ? undefined : structuredClone(patch);
}
