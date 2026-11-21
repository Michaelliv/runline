# Command Line

This page documents the `runline` command, its subcommands, and their options.

```text
runline [options] <command> [arguments]
```

Run `runline --help` or `runline <command> --help` for the same information in the terminal.

## Global options

| Option | Behavior |
|---|---|
| `--json` | Print one JSON value instead of formatted text |
| `-q`, `--quiet` | Suppress progress and informational output |
| `--no-color` | Disable colored output |
| `-v`, `--version` | Print the version and exit |

Runline reads the nearest `.runline` folder at or above the working directory. See [Configuration](configuration.md).

## Run code

```sh
runline exec 'return await github.issue.get({ owner: "nodejs", repo: "node", issueNumber: 1 })'
runline exec -f ./scripts/triage.js
runline actions --connected
```

See [Run Code](usage.md) for the calling conventions and the runtime.

- `exec <code>`, alias `e`<br>
  Runs JavaScript and prints the returned value. Logs go to stderr. A failed run exits with status 1. With `--json`, prints `{ result, logs }` or `{ error, logs }`.
- `exec -f`, `--file`<br>
  Treats `<code>` as the path of a file to run.
- `exec -e`, `--package <source>`<br>
  Loads a package for this run without recording it. Repeat it for several packages. A relative path resolves from the working directory.
- `actions`<br>
  Lists every loadable action with its access label, inputs, and description. With `--json`, includes each input schema.
- `actions -c`, `--connected`<br>
  Lists only the actions of plugins that have a connection.
- `actions -e`, `--package <source>`<br>
  Includes a package's actions for this listing only.

`exec` loads a bundled plugin only when a connection names it. `actions` loads every bundled plugin.

## Connections

```sh
runline connection add gh --plugin github --set token=$GITHUB_TOKEN
runline auth gmail
```

See [Connections](connections.md) for environment variables, OAuth setup, and storage.

- `connection add <name> -p <plugin>`<br>
  Adds a connection, or replaces the one with that name. `-p`, `--plugin` is required. `conn` is an alias of `connection`.
- `connection add -s`, `--set <key=value>`<br>
  Sets one config value. Repeat it for several values.
- `connection list`<br>
  Lists connections. With `--json`, includes field names with redacted values.
- `connection remove <name>`<br>
  Removes a connection.
- `auth <plugin>`<br>
  Runs the plugin's OAuth login in the browser and saves the tokens as a connection.
- `auth -n`, `--name <name>`<br>
  Names the connection. The default is the plugin name.
- `auth --client-id <id>`, `--client-secret <secret>`<br>
  Supply the OAuth client. Without them, runline reads the plugin's environment variables and then prompts.

<a id="package-commands"></a>

## Packages

```sh
runline install npm:@example/runline-orders@1.2.0
runline list --outdated
runline update
```

See [Packages](packages.md) for sources, versions, and the package format.

- `install <source>`<br>
  Fetches a package, shows its plugins, action counts, and credential targets, and records it after confirmation. Install scripts do not run.
- `install -l`, `--local`<br>
  Records the package in the project's `.runline` folder instead of `~/.runline`, and trusts the project.
- `install -y`, `--yes`<br>
  Installs without asking. Required when there is no terminal.
- `remove <source>`, alias `uninstall`<br>
  Removes a package's entry and its installed files. Add `-l`, `--local` to remove it from the project.
- `update [source]`<br>
  Updates one package or all of them. Exact versions, tags, and commits stay where they are.
- `list`, alias `ls`<br>
  Lists configured packages. Add `--outdated` to show the ones with newer versions.
- `search [terms]`<br>
  Searches npm for packages with the `runline-plugin` keyword.

A source is `npm:<name>[@version]`, `git:<host>/<path>[@ref]`, a git URL, or a local path.

## Plugins

- `plugin list`<br>
  Lists loaded plugins with their versions, action counts, and the folder or package each came from.
- `plugin install <source>`<br>
  Installs a package into the project without asking. Add `-g`, `--global` to install into `~/.runline`.
- `plugin remove <source>`<br>
  Removes a package from the project, or from `~/.runline` when the project does not have it.

## Projects

```sh
runline init
runline trust
```

- `init`<br>
  Creates `.runline/config.json` and `.runline/plugins/` in the working directory and trusts the new project.
- `trust [dir]`<br>
  Allows the plugins and packages of a project's `.runline` folder to load. The default is the nearest one.
- `trust --revoke`<br>
  Withdraws that trust.

See [Project trust](security.md#understand-project-trust).

## Exit status

Commands exit with status 0 on success and 1 on failure. With `--json`, a failed package command prints `{ ok: false, error, code }`.
