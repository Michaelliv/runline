# Codemode

Codemode turns APIs and host capabilities into actions, and an agent calls them by writing JavaScript.

Each configured plugin is a global in that code. One run can search for an action, check its input, call several services, and return a single value, so an agent needs one tool instead of one per endpoint.

Codemode ships with [plugins for more than 200 services](docs/bundled-plugins.md). Add your own with a [plugin file](docs/plugins.md), or install and share them as [packages](docs/packages.md) through npm or git.

Use codemode from the [command line](docs/cli.md), embed it with the [TypeScript SDK](docs/sdk.md), or add it to Pi with [`pi-runline`](https://github.com/Michaelliv/pi-runline).

## Getting started

Install the command-line interface. This requires Node.js 22.12 or newer, or 20.19 or newer on the Node.js 20 line:

```bash
npm install -g @shiftlabs/codemode
```

Create a project and add a connection for the plugin you want to use:

```bash
codemode init
codemode connection add gh --plugin github --set token=$GITHUB_TOKEN
```

Run code that calls its actions:

```bash
codemode exec '
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
codemode exec 'return actions.find("create issue")'
codemode exec 'return actions.describe("github.issue.create")'
```

See the [documentation](docs/index.md) for the [quickstart](docs/quickstart.md), the guides, and the [command](docs/cli.md), [configuration](docs/configuration.md), and [credentials](docs/credentials-reference.md) reference.

## Permissions

Codemode is not a sandbox. Plugins run inside the codemode process with its permissions, and the worker thread that runs code can load Node.js modules. Actions that write, send, or delete run without asking.

Codemode loads a project's plugins and packages only after you trust the project. Review third-party packages before installing them, and isolate the process when the code is untrusted. See [Security](docs/security.md).

## Related projects

[dripline](https://github.com/Michaelliv/dripline) is query mode: SQL tables over live APIs. Codemode is JavaScript actions over the same kind of APIs. Use dripline to select rows, and codemode to create, update, delete, or chain calls.

## Development

Codemode is a Bun workspace with three packages. It was called runline through 0.45; see [Migrate from runline](docs/migrating-from-runline.md).


| Package | Contents |
|---|---|
| [`packages/codemode`](packages/codemode) | The library and command-line interface, published as `codemode` |
| [`packages/codemode-plugins`](packages/codemode-plugins) | The bundled plugins, built into codemode's `dist` |
| [`packages/runline`](packages/runline) | The `runline` package on npm, which forwards to codemode until 0.48.0 |

Install dependencies and run the command-line interface from source:

```bash
bun install
bun --filter @shiftlabs/codemode dev -- exec 'return 1 + 2'
```

Before submitting changes, run:

```bash
bun --filter @shiftlabs/codemode build
bun run typecheck
bun --filter @shiftlabs/codemode test
bun run check
```

## License

MIT
