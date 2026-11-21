# Quickstart

Runline runs JavaScript that calls actions. Actions come from plugins, and a plugin becomes available once it has a connection. This page installs runline, adds two connections, and runs code against them.

## 1. Install runline

Install the command-line interface from npm. This requires Node.js 22.12 or newer:

```bash
npm install -g runline
```

Verify the installation:

```bash
runline --version
```

## 2. Create a project

Change to the folder you want to work in, then create its `.runline` folder:

```bash
cd /path/to/folder
runline init
```

`runline init` creates `.runline/config.json` and an empty `.runline/plugins/` folder. Runline reads the nearest `.runline` folder at or above the working directory.

## 3. Add a connection

A **plugin** is a set of actions for one service. A **connection** is the configuration a plugin runs with, usually its credentials.

The bundled `node` plugin needs no credentials. Add a connection to make it available:

```bash
runline connection add node --plugin node
```

Most plugins need a key or token. Pass it with `--set`:

```bash
runline connection add gh --plugin github --set token=$GITHUB_TOKEN
```

See [Bundled Plugins](bundled-plugins.md) for every plugin and the values it needs, and [Connections](connections.md) for environment variables and OAuth logins.

## 4. Run code

Pass JavaScript to `runline exec`. Each plugin with a connection is a global, and `return` produces the result:

```bash
runline exec 'return await node.os.platform()'
```

One run can call several actions and combine their results:

```bash
runline exec '
  const repo = await github.repository.get({ owner: "nodejs", repo: "node" });
  const host = await node.os.platform();
  return { stars: repo.stargazers_count, host };
'
```

Actions that create, change, or send something run without asking. Review code before running it against a real account. See [Security](security.md).

## 5. Discover actions

Code can search and inspect the available actions through the `actions` object:

```bash
runline exec 'return actions.find("create issue")'
runline exec 'return actions.describe("github.issue.create")'
```

See [Run Code](usage.md) for the complete discovery flow, logs, and JSON output.

## Next steps

- [Run code](usage.md) to learn the calling conventions and what the runtime provides.
- [Write a plugin](plugins.md) to add actions for an API that is not bundled.
- [Use the SDK](sdk.md) to run the same code from an application.

### Choose how to extend runline

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Call a service that runline already supports | A [connection](connections.md) for the bundled plugin |
| Add actions for one project | A plugin file in [`.runline/plugins/`](plugins.md) |
| Add actions for every project on your machine | A plugin file in `~/.runline/plugins/` |
| Share plugins with other people or projects | A [package](packages.md) |
| Run code and manage connections from an application | The [SDK](sdk.md) |

## Uninstall runline

Remove the command-line interface with npm:

```bash
npm uninstall -g runline
```

This does not remove `~/.runline`, which holds your plugins, installed packages, and trust decisions, or any project's `.runline` folder.
