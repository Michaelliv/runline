import type { CredentialDeclaration } from "../credentials/types.js";
import type {
  ActionAccess,
  ActionContext,
  ActionDef,
  ConnectionSchema,
  InputOf,
  InputSchema,
  LegacyInputSchema,
  OAuthConfig,
  PluginDef,
} from "./types.js";

export interface ActionDefinition<S extends InputSchema = InputSchema> {
  access?: ActionAccess;
  description?: string;
  inputSchema?: S;
  execute: (
    input: InputOf<S>,
    ctx: ActionContext,
  ) => unknown | Promise<unknown>;
}

export interface RunlinePluginAPI {
  registerAction<const S extends InputSchema = LegacyInputSchema>(
    name: string,
    def: ActionDefinition<S>,
  ): void;
  setConnectionSchema(schema: ConnectionSchema): void;
  setName(name: string): void;
  setVersion(version: string): void;
  /**
   * Declare OAuth2 configuration so `runline auth <plugin>` can
   * run the browser login flow and seed this plugin's connection
   * with refreshable tokens.
   */
  setOAuth(oauth: OAuthConfig): void;
  /**
   * Declare how a connection's config becomes what this plugin's requests
   * are signed with, so a host brokering for it can sign from the plugin
   * it loaded rather than from anything the plugin's process sends.
   */
  setCredential(declaration: CredentialDeclaration): void;
  onInit(fn: (config: Record<string, unknown>) => void): void;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export type PluginFunction = (api: RunlinePluginAPI) => void;

/**
 * What every run's scope holds besides the plugins. A plugin is a global in
 * that scope under its own name, so it cannot be named like one of these.
 */
export const RUNTIME_GLOBALS = [
  "actions",
  "console",
  "fetch",
  "require",
  "FerroSearch",
] as const;

/**
 * A plugin's name is a variable in the code that calls it. One that cannot
 * be a variable there would fail every run, for every plugin, so it is
 * refused when the plugin loads.
 */
export function assertPluginName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}": must be a valid JS identifier (no hyphens, no dots). Use camelCase.`,
    );
  }
  let declarable = !(RUNTIME_GLOBALS as readonly string[]).includes(name);
  try {
    // The engine's own declaration of a run's names. Reserved words pass
    // the pattern above and fail here.
    new Function(name, '"use strict";');
  } catch {
    declarable = false;
  }
  if (!declarable)
    throw new Error(
      `Invalid plugin name "${name}": the name is reserved by JavaScript or by the code runtime.`,
    );
}

/**
 * `pluginId` names the plugin until it calls `setName`. `null` means there
 * is no such fallback: a plugin that sets no name does not resolve.
 */
export function createPluginAPI(pluginId: string | null): {
  api: RunlinePluginAPI;
  resolve: () => PluginDef;
} {
  let name = pluginId;
  let version = "0.0.0";
  const actions: ActionDef[] = [];
  let connectionConfigSchema: PluginDef["connectionConfigSchema"];
  let oauth: OAuthConfig | undefined;
  let credential: CredentialDeclaration | undefined;
  const initHooks: Array<(config: Record<string, unknown>) => void> = [];

  const api: RunlinePluginAPI = {
    setName(n: string) {
      assertPluginName(n);
      name = n;
    },
    setVersion(v: string) {
      version = v;
    },
    registerAction<S extends InputSchema>(
      actionName: string,
      def: ActionDefinition<S>,
    ) {
      // The engine validates input against a TypeBox schema before
      // execute, so the handler's typed input holds at this boundary.
      actions.push({ name: actionName, ...def } as ActionDef);
    },
    setConnectionSchema(schema: ConnectionSchema) {
      connectionConfigSchema = { ...schema };
    },
    setOAuth(cfg: OAuthConfig) {
      oauth = { ...cfg };
    },
    setCredential(declaration: CredentialDeclaration) {
      credential = declaration;
    },
    onInit(fn) {
      initHooks.push(fn);
    },
    log: {
      info(msg: string) {
        console.log(`[${name ?? "plugin"}] ${msg}`);
      },
      warn(msg: string) {
        console.warn(`[${name ?? "plugin"}] ${msg}`);
      },
      error(msg: string) {
        console.error(`[${name ?? "plugin"}] ${msg}`);
      },
    },
  };

  function resolve(): PluginDef {
    if (name === null)
      throw new Error("declares no plugin name (call api.setName)");
    assertPluginName(name);
    const plugin: PluginDef = {
      name,
      version,
      actions,
      connectionConfigSchema,
    };
    if (oauth) {
      plugin.oauth = oauth;
    }
    if (credential) {
      plugin.credential = credential;
    }
    if (initHooks.length > 0) {
      plugin.initHooks = initHooks;
    }
    return plugin;
  }

  return { api, resolve };
}

export function isPluginFunction(val: unknown): val is PluginFunction {
  return typeof val === "function";
}

/**
 * Action names are plugin-relative: plugin "salesforce" registering
 * "salesforce.status" is callable as "salesforce.salesforce.status",
 * which is almost never what the author meant. Warn at resolve time —
 * the earliest point where both the final plugin name and the full
 * action list are known (setName may be called after registerAction,
 * and object exports never go through createPluginAPI).
 */
function warnSelfPrefixedActions(plugin: PluginDef): void {
  for (const action of plugin.actions) {
    const prefixed = action.name.startsWith(`${plugin.name}.`);
    if (!prefixed && action.name !== plugin.name) continue;
    const advice = prefixed
      ? `Rename the action to "${action.name.slice(plugin.name.length + 1)}".`
      : "Choose an action name that does not repeat the plugin name.";
    console.warn(
      `[runline] Plugin "${plugin.name}" registered action "${action.name}", which repeats the plugin name. ` +
        `Action names are plugin-relative, so this action is callable as "${plugin.name}.${action.name}" — ` +
        `not "${action.name}". ${advice}`,
    );
  }
}

/**
 * A module's export as a plugin definition with a usable name. `pluginId`
 * names a function-form plugin that sets none; `null` requires it to.
 */
export function resolvePluginExport(
  exported: PluginFunction | PluginDef,
  pluginId: string | null,
): PluginDef {
  if (isPluginFunction(exported)) {
    const { api, resolve } = createPluginAPI(pluginId);
    exported(api);
    const plugin = resolve();
    warnSelfPrefixedActions(plugin);
    return plugin;
  }
  if (exported && typeof exported === "object" && "actions" in exported) {
    const plugin = exported as PluginDef;
    assertPluginName(plugin.name);
    warnSelfPrefixedActions(plugin);
    return plugin;
  }
  throw new Error(
    `Invalid plugin export${pluginId === null ? "" : ` from "${pluginId}"`}: expected a function or { name, actions } object`,
  );
}
