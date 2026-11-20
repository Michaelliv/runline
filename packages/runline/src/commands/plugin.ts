import chalk from "chalk";
import { listInstalled, removePlugin } from "../plugin/installer.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson, printSuccess } from "../utils/output.js";
import { cliPackageManager, packageInstall } from "./packages.js";

/**
 * `runline plugin …`: the commands from before packages, kept as aliases.
 * `plugin install` is `install --yes` (it never prompted), project scope
 * unless `--global`.
 */
export async function pluginInstall(
  source: string,
  options: { global?: boolean; json?: boolean },
): Promise<void> {
  await packageInstall(source, {
    local: !options.global,
    yes: true,
    json: options.json,
  });
}

export async function pluginRemove(
  name: string,
  options: { json?: boolean },
): Promise<void> {
  let removed = false;
  try {
    removed = removePlugin(name);
    if (!removed) {
      const pm = cliPackageManager({ quiet: true, trustProject: true });
      for (const scope of ["project", "user"] as const) {
        removed = await pm.remove(name, { scope }).catch(() => false);
        if (removed) break;
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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
  const pm = cliPackageManager({ quiet: true });
  await loadAllPlugins({ packages: pm });
  const installed = listInstalled();
  const { loaded: packaged } = await pm.load();
  const sourceOf = (name: string) =>
    packaged.find((p) => p.plugin.name === name)?.source ??
    installed.find((i) => i.name === name)?.source;
  const loaded = registry.listPlugins();

  if (options.json) {
    printJson(
      loaded.map((p) => ({
        name: p.name,
        version: p.version,
        actions: p.actions.map((a) => a.name),
        source: sourceOf(p.name),
      })),
    );
    return;
  }

  if (loaded.length === 0) {
    console.log("No plugins loaded.");
    return;
  }

  for (const p of loaded) {
    const src = sourceOf(p.name);
    const srcLabel = src ? chalk.dim(` (${src})`) : "";
    console.log(
      `  ${chalk.bold(p.name)} v${p.version}${srcLabel} — ${p.actions.length} action(s)`,
    );
  }
}
