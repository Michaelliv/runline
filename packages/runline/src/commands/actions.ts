import chalk from "chalk";
import { loadConfig } from "../config/loader.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printJson } from "../utils/output.js";

export async function actions(options: {
  json?: boolean;
  connected?: boolean;
}): Promise<void> {
  await loadAllPlugins();
  const all = registry.getAllActions();
  const connectedPlugins = options.connected
    ? new Set(loadConfig().connections.map((c) => c.plugin))
    : null;
  const filtered = connectedPlugins
    ? all.filter(({ plugin }) => connectedPlugins.has(plugin))
    : all;

  if (options.json) {
    printJson(
      filtered.map(({ plugin, action }) => ({
        plugin,
        action: action.name,
        description: action.description,
        inputSchema: action.inputSchema,
      })),
    );
    return;
  }

  if (filtered.length === 0) {
    if (options.connected) {
      console.log("No actions found for connected services.");
      console.log(
        "Add a connection first: runline connection add <name> -p <plugin>",
      );
    } else {
      console.log("No actions registered. Install a plugin first.");
    }
    return;
  }

  const grouped = new Map<string, typeof filtered>();
  for (const entry of filtered) {
    const list = grouped.get(entry.plugin) ?? [];
    list.push(entry);
    grouped.set(entry.plugin, list);
  }

  for (const [plugin, entries] of grouped) {
    console.log(chalk.bold(`\n${plugin}`));
    for (const { action } of entries) {
      const path = chalk.cyan(`${plugin}.${action.name}`);
      const desc = action.description
        ? chalk.dim(` — ${action.description}`)
        : "";
      const schema = action.inputSchema
        ? chalk.dim(
            ` (${Object.entries(action.inputSchema)
              .map(([k, v]) => `${k}: ${v.type}${v.required ? "" : "?"}`)
              .join(", ")})`,
          )
        : "";
      console.log(`  ${path}${schema}${desc}`);
    }
  }
  console.log();
}
