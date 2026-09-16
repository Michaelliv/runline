import type { ConnectionConfig, ConnectionSchema } from "../plugin/types.js";

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
