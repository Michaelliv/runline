export { AuthError, type AuthErrorCode } from "./auth/errors.js";
export {
  acquireOAuth2ClientToken,
  acquireOAuth2JwtToken,
  acquireOAuth2PasswordToken,
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
  OAuthJwtIdentity,
  OAuthOperation,
  OAuthResourceOwner,
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
  userConfigDir,
} from "./config/loader.js";
export {
  isProjectTrusted,
  setProjectTrusted,
  trustedProjects,
} from "./config/trust.js";
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
  oauthCallback,
  runOAuth,
} from "./core/oauth.js";
export { awsEndpoint, awsRegion, parseAwsXml } from "./credentials/aws.js";
export type { AwsCredentialSpec } from "./credentials/aws-plugin.js";
export {
  awsCredential,
  awsFailed,
  awsJson,
  awsList,
  awsQuery,
  awsTarget,
} from "./credentials/aws-plugin.js";
export { brokerFor } from "./credentials/broker.js";
export type {
  DownloadCheck,
  Downloaded,
  DownloadSource,
  DownloadTo,
} from "./credentials/download.js";
export { rangedDownload } from "./credentials/download.js";
export {
  downloadResource,
  type PresignedRequestOptions,
  presignedRequest,
} from "./credentials/http.js";
export type {
  CredentialCall,
  EmptyAnswer,
  ErrorEnvelope,
  StaticCredentialSpec,
} from "./credentials/plugin.js";
export {
  answerFailed,
  configChoice,
  configFlag,
  cookieSessionSchema,
  credentialJson,
  credentialOk,
  credentialRequest,
  credentialSocketUrl,
  errorIdentifier,
  failureMessage,
  grantSchema,
  graphqlFailed,
  hostLabel,
  httpsBase,
  jsonAnswer,
  jsonOrAcknowledged,
  multipartBody,
  pathSegment,
  pathSegments,
  pathWithin,
  refuseUnderHost,
  requestFailed,
  responseFailed,
  slashEncodedSegment,
  staticCredential,
} from "./credentials/plugin.js";
export {
  AwsAccessKeySchema,
  AwsSessionSchema,
  CookieSessionSchema,
  CredentialRegistry,
  OAuthGrantSchema,
  OAuthTokensSchema,
  StoredCookieSchema,
  staticSecretSchema,
  validateCredential,
} from "./credentials/registry.js";
export type {
  AuthenticatedRequest,
  CredentialBroker,
  CredentialBrokerCall,
  CredentialTransportOptions,
  SocketRequest,
} from "./credentials/transport.js";
export { CredentialTransport } from "./credentials/transport.js";
export type {
  AwsAccessKey,
  AwsRole,
  AwsScope,
  AwsSession,
  CookieLogin,
  CookieRejection,
  CookieSession,
  CredentialAuthentication,
  CredentialBinding,
  CredentialDeclaration,
  CredentialMethod,
  CredentialProbe,
  CredentialProbeResult,
  CredentialSelection,
  CredentialTarget,
  CredentialType,
  HttpMethod,
  LocalSecretPart,
  LocalSecretSource,
  OAuthGrant,
  SecretPlacement,
  StoredCookie,
} from "./credentials/types.js";
export {
  isPackageError,
  PackageError,
  type PackageErrorCode,
} from "./packages/errors.js";
export {
  type AvailableUpdate,
  bundledPluginNames,
  type CallOptions,
  type ConfiguredPackage,
  type InstallScope,
  type LoadResult,
  type MissingAction,
  type PackageAction,
  type PackageEvent,
  PackageManager,
  type PackageManagerName,
  type PackageManagerOptions,
  type PackageProblem,
  type PackageReport,
  type PackageRoots,
  type PackageUpdate,
  type PluginReport,
  type ScopeOptions,
  type SearchResult,
  type StagedPackage,
} from "./packages/manager.js";
export {
  HOST_MODULE_SPECIFIERS,
  HOST_MODULES,
  type PackageManifest,
  pluginEntryPoint,
  readPackageManifest,
  type UnsatisfiedPeer,
} from "./packages/manifest.js";
export {
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  nodeCommandRunner,
} from "./packages/runner.js";
export {
  type GitSource,
  isExactVersion,
  type LocalSource,
  type NpmSource,
  type ParsedSource,
  packageIdentity,
  parseSource,
  resolveLocalPath,
} from "./packages/source.js";
export {
  entrySource,
  FilePackageStore,
  MemoryPackageStore,
  type PackageEntry,
  type PackageScope,
  type PackageStore,
} from "./packages/store.js";
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
export {
  discoverPlugins,
  loadAllPlugins,
  loadPluginFromPath,
  loadPluginsFromConfig,
} from "./plugin/loader.js";
export { PluginRegistry, registry } from "./plugin/registry.js";
export { connectionFields } from "./plugin/schema.js";
export type {
  ActionAccess,
  ActionContext,
  ActionDef,
  ConnectionConfig,
  ConnectionSchema,
  ConnectionSchemaField,
  InputField,
  InputOf,
  InputSchema,
  LegacyConnectionSchema,
  OAuthConfig,
  PluginDef,
  PluginSourceInfo,
} from "./plugin/types.js";
export type { RunlineExecuteOptions, RunlineOptions } from "./sdk.js";
export { Runline } from "./sdk.js";
export type { ExecOptions, ExecResult, OutputParser } from "./utils/cli.js";
export { commandExists, syncExec } from "./utils/cli.js";
