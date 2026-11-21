import chalk from "chalk";
import {
  addConnection,
  loadConfig,
  removeConnection,
} from "../config/loader.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import {
  printError,
  printJson,
  printSuccess,
  printWarn,
} from "../utils/output.js";
import { cliPackageManager } from "./packages.js";

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

  // The connection is bound to where the plugin comes from today, so a
  // plugin of the same name from elsewhere does not inherit it. Finding
  // that out imports one bundled plugin at most and installs nothing.
  await loadAllPlugins({
    builtinAllowlist: new Set([options.plugin]),
    packages: cliPackageManager({ quiet: true, onMissing: "skip" }),
  });
  const owner = registry.getPlugin(options.plugin)?.sourceInfo?.owner;
  await addConnection(name, options.plugin, configValues, { owner });

  if (options.json) {
    printJson({ ok: true, name, plugin: options.plugin, owner });
  } else {
    if (owner === undefined)
      printWarn(
        `No plugin named "${options.plugin}" is installed. A package's plugin will need its connection added again once installed.`,
      );
    printSuccess(
      `Connection ${chalk.bold(name)} added (plugin: ${options.plugin})`,
    );
  }
}

export async function connectionRemove(
  name: string,
  options: { json?: boolean },
): Promise<void> {
  const removed = await removeConnection(name);
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
        owner: c.owner,
        config: Object.fromEntries(
          Object.keys(c.config).map((key) => [key, "[redacted]"]),
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
    const owner =
      c.owner && c.owner !== "builtin" ? chalk.dim(` from ${c.owner}`) : "";
    console.log(`  ${chalk.bold(c.name)} (${c.plugin})${owner}`);
  }
}
