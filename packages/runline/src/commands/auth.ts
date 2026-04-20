import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { addConnection } from "../config/loader.js";
import { OAUTH_CALLBACK_PORT, runOAuth } from "../core/oauth.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { printError, printJson, printSuccess } from "../utils/output.js";

export async function auth(
  plugin: string,
  options: {
    name?: string;
    clientId?: string;
    clientSecret?: string;
    json?: boolean;
    quiet?: boolean;
  },
): Promise<void> {
  await loadAllPlugins();
  const def = registry.getPlugin(plugin);
  if (!def) {
    printError(`Plugin "${plugin}" not found. Run \`runline plugin list\`.`);
    process.exit(1);
  }
  if (!def.oauth) {
    printError(`Plugin "${plugin}" does not declare OAuth config.`);
    process.exit(1);
  }

  // Client credentials: CLI flag > env > interactive prompt.
  // Env var names follow the plugin's own convention when declared
  // on its connection schema; fall back to generic names otherwise.
  const envIdVar = def.connectionConfigSchema?.clientId?.env;
  const envSecretVar = def.connectionConfigSchema?.clientSecret?.env;

  const resolvedClientId =
    options.clientId ?? (envIdVar ? process.env[envIdVar] : undefined);
  const resolvedClientSecret =
    options.clientSecret ??
    (envSecretVar ? process.env[envSecretVar] : undefined);

  // If we're about to prompt and the plugin published setup help,
  // print it once so the user knows what to paste. Suppressed
  // under --json and --quiet.
  const willPrompt = !resolvedClientId || !resolvedClientSecret;
  if (
    willPrompt &&
    def.oauth.setupHelp &&
    def.oauth.setupHelp.length > 0 &&
    !options.json &&
    !options.quiet
  ) {
    const redirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;
    console.log();
    console.log(chalk.bold(`Setting up ${plugin} OAuth`));
    console.log();
    for (const line of def.oauth.setupHelp) {
      console.log(
        chalk.dim("  ") +
          line.replace(/\{\{redirectUri\}\}/g, chalk.cyan(redirectUri)),
      );
    }
    console.log();
  }

  const clientId =
    resolvedClientId ?? (await prompt(`${plugin} OAuth client ID: `));
  const clientSecret =
    resolvedClientSecret ?? (await prompt(`${plugin} OAuth client secret: `));

  if (!clientId || !clientSecret) {
    printError("Both client ID and client secret are required.");
    process.exit(1);
  }

  const connectionName = options.name ?? plugin;

  if (!options.quiet && !options.json) {
    console.log(`\nOpening browser to authorize ${chalk.bold(plugin)}\u2026`);
  }

  try {
    const tokens = await runOAuth(def.oauth, {
      clientId,
      clientSecret,
      onAuthUrl: (url) => {
        if (!options.quiet && !options.json) {
          console.log(
            chalk.dim(`If it doesn't open automatically, visit:\n  ${url}\n`),
          );
        }
      },
    });

    addConnection(connectionName, plugin, {
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
    });

    if (options.json) {
      printJson({ ok: true, name: connectionName, plugin });
    } else {
      printSuccess(
        `Connection ${chalk.bold(connectionName)} saved (plugin: ${plugin})`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    process.exit(1);
  }
}

async function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(q);
    return answer.trim();
  } finally {
    rl.close();
  }
}
