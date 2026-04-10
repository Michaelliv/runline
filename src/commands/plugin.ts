import chalk from "chalk";
import {
  installPlugin,
  listInstalled,
  removePlugin,
} from "../plugin/installer.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson, printSuccess } from "../utils/output.js";

export async function pluginInstall(
  source: string,
  options: { global?: boolean; json?: boolean },
): Promise<void> {
  try {
    const result = await installPlugin(source, { global: options.global });
    if (options.json) {
      printJson({ ok: true, ...result });
    } else {
      printSuccess(
        `Installed ${chalk.bold(result.name)} from ${source}`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    process.exit(1);
  }
}

export async function pluginRemove(
  name: string,
  options: { json?: boolean },
): Promise<void> {
  const removed = removePlugin(name);
  if (!removed) {
    printError(`Plugin "${name}" not found`);
    process.exit(1);
  }
  if (options.json) {
    printJson({ ok: true, removed: name });
  } else {
    printSuccess(`Removed ${chalk.bold(name)}`);
  }
}

export async function pluginList(options: { json?: boolean }): Promise<void> {
  await loadAllPlugins();
  const installed = listInstalled();
  const loaded = registry.listPlugins();

  if (options.json) {
    printJson(
      loaded.map((p) => ({
        name: p.name,
        version: p.version,
        actions: p.actions.map((a) => a.name),
        source: installed.find((i) => i.name === p.name)?.source,
      })),
    );
    return;
  }

  if (loaded.length === 0) {
    console.log("No plugins loaded.");
    return;
  }

  for (const p of loaded) {
    const src = installed.find((i) => i.name === p.name);
    const srcLabel = src ? chalk.dim(` (${src.source})`) : "";
    console.log(
      `  ${chalk.bold(p.name)} v${p.version}${srcLabel} — ${p.actions.length} action(s)`,
    );
  }
}
