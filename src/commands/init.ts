import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { DEFAULT_CONFIG } from "../config/types.js";
import { printJson, printSuccess, printWarn } from "../utils/output.js";

export async function init(options: {
  json?: boolean;
  quiet?: boolean;
}): Promise<void> {
  const dir = join(process.cwd(), ".runline");

  if (existsSync(dir)) {
    if (options.json) {
      printJson({ ok: true, exists: true, path: dir });
    } else if (!options.quiet) {
      printWarn(`${chalk.bold(".runline/")} already exists`);
    }
    return;
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "plugins"), { recursive: true });

  writeFileSync(
    join(dir, "config.json"),
    `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
  );

  if (options.json) {
    printJson({ ok: true, path: dir });
  } else if (!options.quiet) {
    printSuccess(`Created ${chalk.bold(".runline/")} in current directory`);
  }
}
