import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../config/loader.js";
import { ExecutionEngine } from "../core/engine.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson } from "../utils/output.js";

export async function exec(
  codeOrFile: string,
  options: { json?: boolean; quiet?: boolean },
): Promise<void> {
  await loadAllPlugins();
  const config = loadConfig();
  const engine = new ExecutionEngine(registry, config);

  // If it looks like a file path, read it
  let code = codeOrFile;
  if (
    (codeOrFile.endsWith(".js") || codeOrFile.startsWith("./") || codeOrFile.startsWith("/")) &&
    existsSync(codeOrFile)
  ) {
    code = readFileSync(codeOrFile, "utf-8");
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
