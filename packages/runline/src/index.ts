export { AuthError, type AuthErrorCode } from "./auth/errors.js";
export {
  acquireOAuth2ClientToken,
  buildOAuth2AuthorizationUrl,
  exchangeOAuth2Code,
  refreshOAuth2Token,
} from "./auth/oauth2.js";
export { decodeOAuthTokens, requestOAuth2Token } from "./auth/token.js";
export type {
  OAuth2Definition,
  OAuth2TokenEndpoint,
  OAuthApplication,
  OAuthAuthorizationOptions,
  OAuthCodeOptions,
  OAuthEvent,
  OAuthOperation,
  OAuthRuntimeOptions,
} from "./auth/types.js";
export {
  addConnection,
  findConfigDir,
  getConnection,
  loadConfig,
  removeConnection,
  saveConfig,
  updateConnectionConfig,
} from "./config/loader.js";
export type { RunlineConfig } from "./config/types.js";
export { DEFAULT_CONFIG } from "./config/types.js";
export { FileConnectionProvider } from "./connections/file.js";
export { MemoryConnectionProvider } from "./connections/memory.js";
export type {
  ConnectionHandle,
  ConnectionPatch,
  ConnectionProvider,
  ConnectionRequest,
  ConnectionUpdate,
  ConnectionUpdater,
} from "./connections/types.js";
export type {
  ActionInvocation,
  EngineHooks,
  EngineOptions,
  ExecuteResult,
} from "./core/engine.js";
export { ExecutionEngine } from "./core/engine.js";
export type {
  BuildAuthUrlOptions,
  ExchangeCodeOptions,
  OAuthTokens,
  PKCEPair,
  RunOAuthOptions,
} from "./core/oauth.js";
export {
  buildAuthUrl,
  exchangeAuthCode,
  generatePKCE,
  OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_URI,
  runOAuth,
} from "./core/oauth.js";
export type {
  ActionDefinition,
  PluginFunction,
  RunlinePluginAPI,
} from "./plugin/api.js";
export {
  createPluginAPI,
  isPluginFunction,
  resolvePluginExport,
} from "./plugin/api.js";
export type { InstalledPlugin, PluginSource } from "./plugin/installer.js";
export {
  installPlugin,
  listInstalled,
  parsePluginSource,
  removePlugin,
} from "./plugin/installer.js";
export {
  discoverPlugins,
  loadAllPlugins,
  loadPluginFromPath,
  loadPluginsFromConfig,
} from "./plugin/loader.js";
export { PluginRegistry, registry } from "./plugin/registry.js";
export type {
  ActionAccess,
  ActionContext,
  ActionDef,
  ConnectionConfig,
  ConnectionSchema,
  ConnectionSchemaField,
  InputField,
  InputSchema,
  LegacyConnectionSchema,
  OAuthConfig,
  PluginDef,
} from "./plugin/types.js";
export type { RunlineExecuteOptions, RunlineOptions } from "./sdk.js";
export { Runline } from "./sdk.js";
export type { ExecOptions, ExecResult, OutputParser } from "./utils/cli.js";
export { commandExists, syncExec } from "./utils/cli.js";
