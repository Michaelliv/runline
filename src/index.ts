export {
  addConnection,
  findConfigDir,
  getConnection,
  loadConfig,
  removeConnection,
  saveConfig,
} from "./config/loader.js";
export type { RunlineConfig } from "./config/types.js";
export { DEFAULT_CONFIG } from "./config/types.js";
export { ExecutionEngine } from "./core/engine.js";
export type { EngineOptions, ExecuteResult } from "./core/engine.js";
export {
  createPluginAPI,
  isPluginFunction,
  resolvePluginExport,
} from "./plugin/api.js";
export type {
  ActionDefinition,
  PluginFunction,
  RunlinePluginAPI,
  SchemaField,
} from "./plugin/api.js";
export {
  installPlugin,
  listInstalled,
  parsePluginSource,
  removePlugin,
} from "./plugin/installer.js";
export type { InstalledPlugin, PluginSource } from "./plugin/installer.js";
export {
  loadAllPlugins,
  loadPluginFromPath,
  loadPluginsFromConfig,
} from "./plugin/loader.js";
export { PluginRegistry, registry } from "./plugin/registry.js";
export type {
  ActionContext,
  ActionDef,
  ConnectionConfig,
  InputField,
  InputSchema,
  PluginDef,
} from "./plugin/types.js";
export { Runline } from "./sdk.js";
export type { RunlineOptions } from "./sdk.js";
export type { ExecOptions, ExecResult, OutputParser } from "./utils/cli.js";
export { commandExists, syncExec } from "./utils/cli.js";
