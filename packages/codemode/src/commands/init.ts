import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import chalk from "chalk";
import { configDirIn } from "../config/loader.js";
import { updateConnectionFile } from "../config/store.js";
import { setProjectTrusted } from "../config/trust.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { printJson, printSuccess, printWarn } from "../utils/output.js";

export async function init(options: {
  json?: boolean;
  quiet?: boolean;
}): Promise<void> {
  const dir = join(process.cwd(), ".codemode");

  // A `.runline` folder here is this project already: a new folder beside
  // it would be used in its place, hiding its connections and plugins.
  const existing = configDirIn(process.cwd());
  if (existing) {
    if (options.json) {
      printJson({ ok: true, exists: true, path: existing });
    } else if (!options.quiet) {
      printWarn(`${chalk.bold(`${basename(existing)}/`)} already exists`);
    }
    return;
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "plugins"), { recursive: true });

  const path = join(dir, "config.json");
  await updateConnectionFile(path, (data) => {
    if (existsSync(path)) return { result: undefined, write: false };
    Object.assign(data, structuredClone(DEFAULT_CONFIG));
    return { result: undefined, write: true };
  });
  // The person creating a project trusts the plugins they will put in it.
  setProjectTrusted(dir, true);

  if (options.json) {
    printJson({ ok: true, path: dir });
  } else if (!options.quiet) {
    printSuccess(`Created ${chalk.bold(".codemode/")} in current directory`);
  }
}
