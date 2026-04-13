import type { ConnectionConfig } from "../plugin/types.js";

export interface RunlineConfig {
  connections: ConnectionConfig[];
  /** Execution timeout in ms. Default 30_000. */
  timeoutMs: number;
  /** Memory limit for QuickJS in bytes. Default 64MB. */
  memoryLimitBytes: number;
}

export const DEFAULT_CONFIG: RunlineConfig = {
  connections: [],
  timeoutMs: 30_000,
  memoryLimitBytes: 64 * 1024 * 1024,
};
