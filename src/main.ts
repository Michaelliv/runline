#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";
import { actions } from "./commands/actions.js";
import {
  connectionAdd,
  connectionList,
  connectionRemove,
} from "./commands/connection.js";
import { exec } from "./commands/exec.js";
import { init } from "./commands/init.js";
import { pluginInstall, pluginList, pluginRemove } from "./commands/plugin.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("runline")
  .description("Code mode for agents — turn any API or command into a callable action")
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
  $ runline exec 'const containers = await actions.docker.list(); return containers'
  $ runline exec ./scripts/deploy.js
  $ runline actions
  $ runline connection add gh --plugin github --set token=ghp_xxx

https://github.com/Michaelliv/runline`,
  );

program
  .command("exec <code>")
  .alias("e")
  .description("Execute JavaScript code in the sandbox")
  .addHelpText(
    "after",
    `
The code runs in a QuickJS sandbox with an \`actions\` proxy.
Call plugin actions via: actions.<plugin>.<action>(input)

Examples:
  $ runline exec 'const r = await actions.docker["containers.list"](); return r'
  $ runline exec ./my-script.js
  $ runline exec 'console.log(await actions.github.repos({ owner: "torvalds" }))'`,
  )
  .action(async (code, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await exec(code, { json: globals.json, quiet: globals.quiet });
  });

program
  .command("actions")
  .description("List all available actions and their schemas")
  .action(async (_opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await actions({ json: globals.json });
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

// ── plugin ──────────────────────────────────────────────

const pluginCmd = program.command("plugin").description("Manage plugins");

pluginCmd
  .command("install <source>")
  .description("Install a plugin (npm:pkg, git:repo, or local path)")
  .option("-g, --global", "Install globally")
  .action(async (source, opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginInstall(source, { global: opts.global, json: globals.json });
  });

pluginCmd
  .command("remove <name>")
  .description("Remove an installed plugin")
  .action(async (name, _opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginRemove(name, { json: globals.json });
  });

pluginCmd
  .command("list")
  .description("List all plugins")
  .action(async (_opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    await pluginList({ json: globals.json });
  });

// ── init ────────────────────────────────────────────────

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
