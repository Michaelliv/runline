#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { actions } from "./commands/actions.js";
import { auth } from "./commands/auth.js";
import {
  connectionAdd,
  connectionList,
  connectionRemove,
} from "./commands/connection.js";
import { exec } from "./commands/exec.js";
import { init } from "./commands/init.js";
import {
  packageInstall,
  packageList,
  packageRemove,
  packageSearch,
  packageTrust,
  packageUpdate,
} from "./commands/packages.js";
import { pluginInstall, pluginList, pluginRemove } from "./commands/plugin.js";

const collect = (value: string, previous: string[]) => [...previous, value];

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("runline")
  .description(
    "Code mode for agents — turn any API or command into a callable action",
  )
  .version(`runline ${version}`, "-v, --version")
  .option("--json", "Output as JSON")
  .option("-q, --quiet", "Suppress output")
  .option("--no-color", "Disable color output")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts().color === false) {
      process.env.NO_COLOR = "1";
    }
  })
  .addHelpText(
    "after",
    `
Examples:
  $ runline exec 'return await docker.containers.list()'
  $ runline exec -f ./scripts/deploy.js
  $ runline actions
  $ runline connection add gh --plugin github --set token=ghp_xxx
  $ runline auth gmail

https://github.com/Michaelliv/runline`,
  );

program
  .command("exec <code>")
  .alias("e")
  .description("Execute JavaScript code in the QuickJS runtime")
  .option("-f, --file", "Treat <code> as a file path")
  .option(
    "-e, --package <source>",
    "Load a package for this run only (repeatable)",
    collect,
    [],
  )
  .addHelpText(
    "after",
    `
The code runs in a QuickJS runtime with an \`actions\` proxy.
Each installed plugin is a top-level global. Dot-chain into resource and action.
Configure the built-in \`node\` plugin to expose host-backed fs/path/os/process/crypto/fetch actions.

Examples:
  $ runline exec 'return await docker.containers.list()'
  $ runline exec -f ./scripts/deploy.js
  $ runline exec 'return await github.repo.list({ owner: "torvalds" })'`,
  )
  .action(async (code, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await exec(code, {
      file: opts.file,
      packages: opts.package,
      json: globals.json,
      quiet: globals.quiet,
    });
  });

program
  .command("actions")
  .description("List all available actions and their schemas")
  .option(
    "-c, --connected",
    "Only show actions for plugins with configured connections",
  )
  .option(
    "-e, --package <source>",
    "Load a package for this listing only (repeatable)",
    collect,
    [],
  )
  .action(async (opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await actions({
      json: globals.json,
      connected: opts.connected,
      packages: opts.package,
    });
  });

// ── connection ──────────────────────────────────────────

const connCmd = program
  .command("connection")
  .alias("conn")
  .description("Manage connections");

connCmd
  .command("add <name>")
  .description("Add a connection")
  .requiredOption("-p, --plugin <plugin>", "Plugin name")
  .option(
    "-s, --set <key=value...>",
    "Config values",
    (v: string, prev: string[]) => [...prev, v],
    [],
  )
  .action(async (name, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await connectionAdd(name, {
      plugin: opts.plugin,
      set: opts.set,
      json: globals.json,
    });
  });

connCmd
  .command("remove <name>")
  .description("Remove a connection")
  .action(async (name, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await connectionRemove(name, { json: globals.json });
  });

connCmd
  .command("list")
  .description("List connections")
  .action(async (_opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await connectionList({ json: globals.json });
  });

// ── packages ────────────────────────────────────────────

program
  .command("install <source>")
  .description(
    "Install a plugin package (npm:<name>[@version], git:<host>/<path>[@ref], URL, or path)",
  )
  .option(
    "-l, --local",
    "Record it in the project's .runline instead of ~/.runline",
  )
  .option("-y, --yes", "Install without asking")
  .addHelpText(
    "after",
    `
Fetches the package, shows its plugins, their read/write actions and the
hosts their credentials reach, and asks before recording it. Install
scripts never run.

Examples:
  $ runline install npm:@acme/runline-orders@1.2.0
  $ runline install git:github.com/acme/runline-tools@v1 --local
  $ runline install ./tools/orders`,
  )
  .action(async (source, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageInstall(source, {
      local: opts.local,
      yes: opts.yes,
      json: globals.json,
      quiet: globals.quiet,
    });
  });

program
  .command("remove <source>")
  .alias("uninstall")
  .description("Remove a configured package and its installed files")
  .option("-l, --local", "Remove it from the project's .runline")
  .action(async (source, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageRemove(source, {
      local: opts.local,
      json: globals.json,
      quiet: globals.quiet,
    });
  });

program
  .command("update [source]")
  .description("Update configured packages (exact versions stay pinned)")
  .action(async (source, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageUpdate(source, { json: globals.json, quiet: globals.quiet });
  });

program
  .command("list")
  .alias("ls")
  .description("List configured packages")
  .option("--outdated", "Show packages with newer versions available")
  .action(async (opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageList({ json: globals.json, outdated: opts.outdated });
  });

program
  .command("search [terms]")
  .description("Search npm for packages with the runline-plugin keyword")
  .action(async (terms, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageSearch(terms ?? "", { json: globals.json });
  });

program
  .command("trust [dir]")
  .description("Allow a project's .runline packages to install and load")
  .option("--revoke", "Stop trusting it")
  .action(async (dir, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await packageTrust(dir, { revoke: opts.revoke, json: globals.json });
  });

// ── plugin ──────────────────────────────────────────────

const pluginCmd = program.command("plugin").description("Manage plugins");

pluginCmd
  .command("install <source>")
  .description("Install a plugin package (same as `runline install --yes`)")
  .option("-g, --global", "Install globally")
  .action(async (source, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginInstall(source, { global: opts.global, json: globals.json });
  });

pluginCmd
  .command("remove <source>")
  .description("Remove a package (same as `runline remove`, project first)")
  .action(async (source, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginRemove(source, { json: globals.json });
  });

pluginCmd
  .command("list")
  .description("List loaded plugins and the package each came from")
  .action(async (_opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginList({ json: globals.json });
  });

// ── init ────────────────────────────────────────────────

program
  .command("auth <plugin>")
  .description("Run the OAuth login flow for a plugin and save the connection")
  .option("-n, --name <name>", "Connection name (default: plugin name)")
  .option("--client-id <id>", "OAuth client ID (falls back to env or prompt)")
  .option(
    "--client-secret <secret>",
    "OAuth client secret (falls back to env or prompt)",
  )
  .addHelpText(
    "after",
    `
The plugin must declare OAuth config via setOAuth(). The flow
opens your browser to the provider's consent screen, catches the
redirect on a localhost port, exchanges the code for tokens, and
writes a connection into .runline/config.json.

Examples:
  $ runline auth gmail
  $ runline auth gmail --name gmail-work
  $ runline auth gmail --client-id $CLIENT --client-secret $SECRET`,
  )
  .action(async (plugin, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await auth(plugin, {
      name: opts.name,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      json: globals.json,
      quiet: globals.quiet,
    });
  });

program
  .command("init")
  .description("Create .runline/ in current directory")
  .action(async (_opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await init({ json: globals.json, quiet: globals.quiet });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
