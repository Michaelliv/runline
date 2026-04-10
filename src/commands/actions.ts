import chalk from "chalk";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printJson } from "../utils/output.js";

export async function actions(options: { json?: boolean }): Promise<void> {
  await loadAllPlugins();
  const all = registry.getAllActions();

  if (options.json) {
    printJson(
      all.map(({ plugin, action }) => ({
        plugin,
        action: action.name,
        description: action.description,
        inputSchema: action.inputSchema,
      })),
    );
    return;
  }

  if (all.length === 0) {
    console.log("No actions registered. Install a plugin first.");
    return;
  }

  const grouped = new Map<string, typeof all>();
  for (const entry of all) {
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
