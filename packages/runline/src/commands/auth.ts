import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { addConnection } from "../config/loader.js";
import { oauthCallback, runOAuth } from "../core/oauth.js";
import { loadAllPlugins } from "../plugin/loader.js";
import { registry } from "../plugin/registry.js";
import { connectionFields } from "../plugin/schema.js";
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

  // Client credentials: CLI flag > env > plugin default > interactive prompt.
  // Environment names come from the plugin's connection schema.
  const connectionSchema = connectionFields(def.connectionConfigSchema);
  const envIdVar = connectionSchema.clientId?.env;
  const envSecretVar = connectionSchema.clientSecret?.env;
  const publicClient = def.oauth.publicClient === true;

  const resolvedClientId =
    options.clientId ??
    (envIdVar ? process.env[envIdVar] : undefined) ??
    def.oauth.defaultClientId;
  const resolvedClientSecret = publicClient
    ? undefined
    : (options.clientSecret ??
      (envSecretVar ? process.env[envSecretVar] : undefined));
  if (publicClient && options.clientSecret !== undefined) {
    printError(`Plugin "${plugin}" uses a public OAuth client; no secret.`);
    process.exit(1);
  }

  // If we're about to prompt and the plugin published setup help,
  // print it once so the user knows what to paste. Suppressed
  // under --json and --quiet.
  const willPrompt =
    !resolvedClientId || (!publicClient && !resolvedClientSecret);
  if (
    willPrompt &&
    def.oauth.setupHelp &&
    def.oauth.setupHelp.length > 0 &&
    !options.json &&
    !options.quiet
  ) {
    const redirectUri = oauthCallback(def.oauth).uri;
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
  const clientSecret = publicClient
    ? undefined
    : (resolvedClientSecret ??
      (await prompt(`${plugin} OAuth client secret: `)));

  if (!clientId || (!publicClient && !clientSecret)) {
    printError(
      publicClient
        ? "A client ID is required."
        : "Both client ID and client secret are required.",
    );
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

    await addConnection(connectionName, plugin, {
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
