export interface InputField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
}

export type InputSchema = Record<string, InputField>;

export interface ActionDef {
  name: string;
  description?: string;
  inputSchema?: InputSchema;
  execute: (input: unknown, ctx: ActionContext) => unknown | Promise<unknown>;
}

export interface ConnectionConfig {
  name: string;
  plugin: string;
  config: Record<string, unknown>;
}

export interface ActionContext {
  connection: ConnectionConfig;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export interface PluginDef {
  name: string;
  version: string;
  actions: ActionDef[];
  connectionConfigSchema?: Record<
    string,
    {
      type: string;
      required?: boolean;
      description?: string;
      default?: unknown;
      env?: string;
    }
  >;
  /** @internal */
  initHooks?: Array<(config: Record<string, unknown>) => void>;
}
