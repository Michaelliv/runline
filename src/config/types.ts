import type { ConnectionConfig, RateLimitConfig } from "../plugin/types.js";

export interface RunlineConfig {
  connections: ConnectionConfig[];
  rateLimits: Record<string, RateLimitConfig>;
  /** Execution timeout in ms. Default 30_000. */
  timeoutMs: number;
  /** Memory limit for QuickJS in bytes. Default 64MB. */
  memoryLimitBytes: number;
}

export const DEFAULT_CONFIG: RunlineConfig = {
  connections: [],
  rateLimits: {},
  timeoutMs: 30_000,
  memoryLimitBytes: 64 * 1024 * 1024,
};
