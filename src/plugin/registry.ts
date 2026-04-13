import type { ActionDef, PluginDef } from "./types.js";

export class PluginRegistry {
  private plugins: Map<string, PluginDef> = new Map();

  register(plugin: PluginDef): void {
    this.plugins.set(plugin.name, plugin);
  }

  getPlugin(name: string): PluginDef | undefined {
    return this.plugins.get(name);
  }

  getAction(pluginName: string, actionName: string): ActionDef | undefined {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return undefined;
    return plugin.actions.find((a) => a.name === actionName);
  }

  getAllActions(): Array<{ plugin: string; action: ActionDef }> {
    const result: Array<{ plugin: string; action: ActionDef }> = [];
    for (const [pluginName, plugin] of this.plugins) {
      for (const action of plugin.actions) {
        result.push({ plugin: pluginName, action });
      }
    }
    return result;
  }

  /** Resolve a dotted path like "docker.containers.list" to a plugin + action. */
  resolveAction(path: string): { plugin: PluginDef; action: ActionDef } | undefined {
    const dot = path.indexOf(".");
    if (dot < 0) return undefined;

    const pluginName = path.slice(0, dot);
    const actionName = path.slice(dot + 1);
    const plugin = this.plugins.get(pluginName);
    if (!plugin) return undefined;

    const action = plugin.actions.find((a) => a.name === actionName);
    if (!action) return undefined;

    return { plugin, action };
  }

  listPlugins(): PluginDef[] {
    return Array.from(this.plugins.values());
  }
}

export const registry = new PluginRegistry();
