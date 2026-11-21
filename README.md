# Runline

Runline is code mode for agents. It turns APIs and host capabilities into actions, and an agent calls them by writing JavaScript.

Each configured plugin is a global in that code. One run can search for an action, check its input, call several services, and return a single value, so an agent needs one tool instead of one per endpoint.

Runline ships with [plugins for more than 200 services](docs/bundled-plugins.md). Add your own with a [plugin file](docs/plugins.md), or install and share them as [packages](docs/packages.md) through npm or git.

Use runline from the [command line](docs/cli.md), embed it with the [TypeScript SDK](docs/sdk.md), or add it to [Pi](packages/pi-runline/README.md) as a tool.

## Getting started

Install the command-line interface. This requires Node.js 22.12 or newer:

```bash
npm install -g runline
```

Create a project and add a connection for the plugin you want to use:

```bash
runline init
runline connection add gh --plugin github --set token=$GITHUB_TOKEN
```

Run code that calls its actions:

```bash
runline exec '
  const issue = await github.issue.create({
    owner: "acme",
    repo: "api",
    title: "Login fails for SSO users",
  });
  return issue.number;
'
```

Code discovers actions from inside a run, without a schema dump in the prompt:

```bash
runline exec 'return actions.find("create issue")'
runline exec 'return actions.describe("github.issue.create")'
```

See the [documentation](docs/index.md) for the full [quickstart](docs/quickstart.md) and guides.

## Documentation

| Page | Contents |
|---|---|
| [Quickstart](docs/quickstart.md) | Install runline, add a connection, and run code |
| [How Runline Works](docs/how-runline-works.md) | Plugins, actions, connections, and the runtime |
| [Run Code](docs/usage.md) | Calling conventions, discovery, results, and logs |
| [Connections](docs/connections.md) | Keys, environment variables, and OAuth logins |
| [Plugins](docs/plugins.md) | Write a plugin and understand how plugins load |
| [Credentials](docs/credentials.md) | Declare how a plugin's requests are signed |
| [Packages](docs/packages.md) | Install and distribute plugins through npm or git |
| [Security](docs/security.md) | What runs where, project trust, and credentials |
| [SDK](docs/sdk.md) | Embed runline in an application |
| [Command Line](docs/cli.md) | Every command and option |
| [Configuration](docs/configuration.md) | Files, settings, and environment variables |
| [Bundled Plugins](docs/bundled-plugins.md) | Every plugin that ships with runline |

## Permissions

Runline is not a sandbox. Plugins run inside the runline process with its permissions, and the worker thread that runs code can load Node.js modules. Actions that write, send, or delete run without asking.

Runline loads a project's plugins and packages only after you trust the project. Review third-party packages before installing them, and isolate the process when the code is untrusted. See [Security](docs/security.md).

## Related projects

[dripline](https://github.com/Michaelliv/dripline) is query mode: SQL tables over live APIs. Runline is code mode: JavaScript actions over the same kind of APIs. Use dripline to select rows, and runline to create, update, delete, or chain calls.

## Development

Runline is a Bun workspace with three packages:

| Package | Contents |
|---|---|
| [`packages/runline`](packages/runline) | The library and command-line interface, published as `runline` |
| [`packages/runline-plugins`](packages/runline-plugins) | The bundled plugins, built into runline's `dist` |
| [`packages/pi-runline`](packages/pi-runline) | The Pi extension, published as `pi-runline` |

Install dependencies and run the command-line interface from source:

```bash
bun install
bun --filter runline dev -- exec 'return 1 + 2'
```

Before submitting changes, run:

```bash
bun --filter runline build
bun run typecheck
bun --filter runline test
bun run check
```

## License

MIT
