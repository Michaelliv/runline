# Quickstart

Codemode runs JavaScript that calls actions. Actions come from plugins, and a plugin becomes available once it has a connection. This page installs codemode, adds two connections, and runs code against them.

## 1. Install codemode

Install the command-line interface from npm. This requires Node.js 22.12 or newer, or 20.19 or newer on the Node.js 20 line:

```bash
npm install -g @shiftlabs/codemode
```

Verify the installation:

```bash
codemode --version
```

## 2. Create a project

Change to the folder you want to work in, then create its `.codemode` folder:

```bash
cd /path/to/folder
codemode init
```

`codemode init` creates `.codemode/config.json` and an empty `.codemode/plugins/` folder. Codemode reads the nearest `.codemode` folder at or above the working directory.

## 3. Add a connection

A **plugin** is a set of actions for one service. A **connection** is the configuration a plugin runs with, usually its credentials.

The bundled `node` plugin needs no credentials. Add a connection to make it available:

```bash
codemode connection add node --plugin node
```

Most plugins need a key or token. Pass it with `--set`:

```bash
codemode connection add gh --plugin github --set token=$GITHUB_TOKEN
```

See [Bundled Plugins](bundled-plugins.md) for every plugin and the values it needs, and [Connections](connections.md) for environment variables and OAuth logins.

## 4. Run code

Pass JavaScript to `codemode exec`. Each plugin with a connection is a global, and `return` produces the result:

```bash
codemode exec 'return await node.os.platform()'
```

One run can call several actions and combine their results:

```bash
codemode exec '
  const repo = await github.repository.get({ owner: "nodejs", repo: "node" });
  const host = await node.os.platform();
  return { stars: repo.stargazers_count, host };
'
```

Actions that create, change, or send something run without asking. Review code before running it against a real account. See [Security](security.md).

## 5. Discover actions

Code can search and inspect the available actions through the `actions` object:

```bash
codemode exec 'return actions.find("create issue")'
codemode exec 'return actions.describe("github.issue.create")'
```

See [Run Code](usage.md) for the complete discovery flow, logs, and JSON output.

## Next steps

- [Run code](usage.md) to learn the calling conventions and what the runtime provides.
- [Write a plugin](plugins.md) to add actions for an API that is not bundled.
- [Use the SDK](sdk.md) to run the same code from an application.

### Choose how to extend codemode

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Call a service that codemode already supports | A [connection](connections.md) for the bundled plugin |
| Add actions for one project | A plugin file in [`.codemode/plugins/`](plugins.md) |
| Add actions for every project on your machine | A plugin file in `~/.codemode/plugins/` |
| Share plugins with other people or projects | A [package](packages.md) |
| Run code and manage connections from an application | The [SDK](sdk.md) |

## Uninstall codemode

Remove the command-line interface with npm:

```bash
npm uninstall -g @shiftlabs/codemode
```

This does not remove `~/.codemode`, which holds your plugins, installed packages, and trust decisions, or any project's `.codemode` folder.
