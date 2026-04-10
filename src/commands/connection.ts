import chalk from "chalk";
import {
  addConnection,
  loadConfig,
  removeConnection,
} from "../config/loader.js";
import { printError, printJson, printSuccess } from "../utils/output.js";

export async function connectionAdd(
  name: string,
  options: { plugin: string; set: string[]; json?: boolean },
): Promise<void> {
  const configValues: Record<string, unknown> = {};
  for (const kv of options.set) {
    const eq = kv.indexOf("=");
    if (eq < 0) {
      printError(`Invalid --set value: ${kv} (expected key=value)`);
      process.exit(1);
    }
    configValues[kv.slice(0, eq)] = kv.slice(eq + 1);
  }

  addConnection(name, options.plugin, configValues);

  if (options.json) {
    printJson({ ok: true, name, plugin: options.plugin });
  } else {
    printSuccess(`Connection ${chalk.bold(name)} added (plugin: ${options.plugin})`);
  }
}

export async function connectionRemove(
  name: string,
  options: { json?: boolean },
): Promise<void> {
  const removed = removeConnection(name);
  if (!removed) {
    printError(`Connection "${name}" not found`);
    process.exit(1);
  }

  if (options.json) {
    printJson({ ok: true, removed: name });
  } else {
    printSuccess(`Connection ${chalk.bold(name)} removed`);
  }
}

export async function connectionList(options: {
  json?: boolean;
}): Promise<void> {
  const config = loadConfig();
  const connections = config.connections;

  if (options.json) {
    printJson(
      connections.map((c) => ({
        name: c.name,
        plugin: c.plugin,
        config: Object.fromEntries(
          Object.entries(c.config).map(([k, v]) => [
            k,
            typeof v === "string" && v.length > 8 ? `${v.slice(0, 4)}...` : v,
          ]),
        ),
      })),
    );
    return;
  }

  if (connections.length === 0) {
    console.log("No connections configured.");
    return;
  }

  for (const c of connections) {
    console.log(`  ${chalk.bold(c.name)} (${c.plugin})`);
  }
}
