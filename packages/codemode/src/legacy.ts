/**
 * The package under its runline names, for the `runline` package on npm and
 * for plugins that still import `runline`. It is removed together with the
 * other runline names (`LEGACY_NAMES_REMOVED_IN`).
 */

export type { CodemodeConfig as RunlineConfig } from "./config/types.js";
export * from "./index.js";
export type { CodemodePluginAPI as RunlinePluginAPI } from "./plugin/api.js";
export type {
  CodemodeExecuteOptions as RunlineExecuteOptions,
  CodemodeOptions as RunlineOptions,
} from "./sdk.js";
export { Codemode as Runline } from "./sdk.js";
