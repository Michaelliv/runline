import type { ActionDef, InputSchema, PluginDef } from "./types.js";

export interface SchemaField {
  type: "string" | "number" | "boolean";
  required?: boolean;
  description?: string;
  default?: unknown;
  env?: string;
}

export interface ActionDefinition {
  description?: string;
  inputSchema?: InputSchema;
  execute: ActionDef["execute"];
}

export interface RunlinePluginAPI {
  registerAction(name: string, def: ActionDefinition): void;
  setConnectionSchema(schema: Record<string, SchemaField>): void;
  setName(name: string): void;
  setVersion(version: string): void;
  onInit(fn: (config: Record<string, unknown>) => void): void;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export type PluginFunction = (api: RunlinePluginAPI) => void;

export function createPluginAPI(pluginId: string): {
  api: RunlinePluginAPI;
  resolve: () => PluginDef;
} {
  let name = pluginId;
  let version = "0.0.0";
  const actions: ActionDef[] = [];
  let connectionConfigSchema: PluginDef["connectionConfigSchema"];
  const initHooks: Array<(config: Record<string, unknown>) => void> = [];

  const api: RunlinePluginAPI = {
    setName(n: string) {
      name = n;
    },
    setVersion(v: string) {
      version = v;
    },
    registerAction(actionName: string, def: ActionDefinition) {
      actions.push({ name: actionName, ...def });
    },
    setConnectionSchema(schema: Record<string, SchemaField>) {
      connectionConfigSchema = {};
      for (const [key, field] of Object.entries(schema)) {
        connectionConfigSchema[key] = { ...field };
      }
    },
    onInit(fn) {
      initHooks.push(fn);
    },
    log: {
      info(msg: string) {
        console.log(`[${name}] ${msg}`);
      },
      warn(msg: string) {
        console.warn(`[${name}] ${msg}`);
      },
      error(msg: string) {
        console.error(`[${name}] ${msg}`);
      },
    },
  };

  function resolve(): PluginDef {
    const plugin: PluginDef = {
      name,
      version,
      actions,
      connectionConfigSchema,
    };
    if (initHooks.length > 0) {
      plugin._initHooks = initHooks;
    }
    return plugin;
  }

  return { api, resolve };
}

export function isPluginFunction(val: unknown): val is PluginFunction {
  return typeof val === "function";
}

export function resolvePluginExport(
  exported: PluginFunction | PluginDef,
  pluginId: string,
): PluginDef {
  if (isPluginFunction(exported)) {
    const { api, resolve } = createPluginAPI(pluginId);
    exported(api);
    return resolve();
  }
  if (
    exported &&
    typeof exported === "object" &&
    "actions" in exported
  ) {
    return exported as PluginDef;
  }
  throw new Error(
    `Invalid plugin export from "${pluginId}": expected a function or { name, actions } object`,
  );
}
