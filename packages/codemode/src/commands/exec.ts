import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findConfigDir, loadConfig } from "../config/loader.js";
import { FileConnectionProvider } from "../connections/file.js";
import { ExecutionEngine } from "../core/engine.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson } from "../utils/output.js";
import { cliPackageManager, temporarySources } from "./packages.js";

export async function exec(
  code: string,
  options: {
    file?: boolean;
    json?: boolean;
    quiet?: boolean;
    packages?: string[];
  },
): Promise<void> {
  const config = loadConfig();
  await loadAllPlugins({
    builtinAllowlist: new Set(config.connections.map((c) => c.plugin)),
    packages: cliPackageManager({ quiet: options.quiet || options.json }),
    temporaryPackages: temporarySources(options.packages),
  });
  const configDir = findConfigDir() ?? join(process.cwd(), ".codemode");
  const engine = new ExecutionEngine(registry, config, {
    connectionProvider: new FileConnectionProvider(
      join(configDir, "config.json"),
    ),
  });

  if (options.file) {
    if (!existsSync(code)) {
      printError(`File not found: ${code}`);
      process.exit(1);
    }
    code = readFileSync(code, "utf-8");
  }

  const result = await engine.execute(code);

  if (result.error) {
    if (options.json) {
      printJson({ error: result.error, logs: result.logs });
    } else {
      if (result.logs.length > 0 && !options.quiet) {
        for (const log of result.logs) console.error(log);
      }
      printError(result.error);
    }
    process.exit(1);
  }

  if (options.json) {
    printJson({ result: result.result, logs: result.logs });
  } else {
    if (result.logs.length > 0 && !options.quiet) {
      for (const log of result.logs) console.error(log);
    }
    if (result.result !== null && result.result !== undefined) {
      console.log(
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result, null, 2),
      );
    }
  }
}
