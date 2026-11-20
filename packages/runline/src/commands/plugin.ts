import chalk from "chalk";
import { isPackageError } from "../packages/errors.js";
import type { PackageScope } from "../packages/store.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson, printSuccess } from "../utils/output.js";
import { cliPackageManager, packageInstall } from "./packages.js";

/**
 * `runline plugin install` is `runline install --yes`: no prompt, into the
 * project unless `--global`.
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

/** `runline plugin remove`: the package in the project, else in ~/.runline. */
export async function pluginRemove(
  source: string,
  options: { json?: boolean },
): Promise<void> {
  const pm = cliPackageManager({ quiet: true, trustProject: true });
  let removedFrom: PackageScope | undefined;
  try {
    for (const scope of ["project", "user"] as const) {
      const removed = await pm.remove(source, { scope }).catch((err) => {
        // A missing project folder is not a failure here; the user scope follows.
        if (isPackageError(err) && err.code === "not_found") return false;
        throw err;
      });
      if (removed) {
        removedFrom = scope;
        break;
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (!removedFrom) {
    printError(`No package matches ${source}`);
    process.exit(1);
  }
  if (options.json)
    printJson({ ok: true, removed: source, scope: removedFrom });
  else printSuccess(`Removed ${chalk.bold(source)} (${removedFrom})`);
}

export async function pluginList(options: { json?: boolean }): Promise<void> {
  const packages = await cliPackageManager({ quiet: true }).load();
  await loadAllPlugins({ packages });
  const sourceOf = (name: string) =>
    packages.loaded.find((p) => p.plugin.name === name)?.source;
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
