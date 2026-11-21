import type { PackageEntry } from "../packages/store.js";
import type { ConnectionConfig } from "../plugin/types.js";

export interface RunlineConfig {
  connections: ConnectionConfig[];
  /** Execution timeout in ms. Default 30_000. */
  timeoutMs: number;
  /** Memory limit for QuickJS in bytes. Default 64MB. */
  memoryLimitBytes: number;
  /**
   * Bodies one pooled worker may run before being retired. Bounds cross-run
   * global contamination; memory is a per-thread cost so this does not
   * meaningfully affect it. Default 50.
   */
  maxRunsPerWorker?: number;
  /** Installed plugin packages; `PackageManager` reads and writes them. */
  packages?: PackageEntry[];
  /**
   * Bundled plugins a local plugin of the same name replaces. Without its
   * name here, a local plugin named like a bundled one is not loaded.
   */
  replaceableBuiltins?: string[];
}

export const DEFAULT_CONFIG: RunlineConfig = {
  connections: [],
  timeoutMs: 30_000,
  memoryLimitBytes: 64 * 1024 * 1024,
};
