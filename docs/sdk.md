# SDK

The `runline` package embeds runline in a Node.js or Bun process. It provides the engine, plugin loading, connection storage, credential signing, and package management that the command-line interface uses.

Use the SDK when an application runs code for its own users or agents. The host supplies plugins and connections explicitly, so nothing is read from disk or the environment unless the host asks.

```typescript
import { Runline, type RunlinePluginAPI } from "runline";
import * as t from "typebox";

function greeter(rl: RunlinePluginAPI) {
  rl.setName("greeter");
  rl.setVersion("1.0.0");
  rl.registerAction("hello", {
    access: "read",
    description: "Greet someone by name.",
    inputSchema: t.Object({ name: t.String() }, { additionalProperties: false }),
    execute: ({ name }) => `Hello, ${name}!`,
  });
}

const runline = Runline.create({ plugins: [greeter] });

try {
  const { result, error, logs } = await runline.execute(
    'return await greeter.hello({ name: "Ada" })',
  );
  console.log(error ?? result, logs);
} finally {
  runline.dispose();
}
```

This registers one plugin, keeps its connection in memory, and runs the code in a worker thread. `execute()` resolves when the run finishes.

## Instance lifecycle

`Runline.create()` returns an instance that owns a plugin registry, a connection provider, and one pooled worker thread.

| Option | Purpose |
|---|---|
| `plugins` | Plugin functions or plugin definitions to register |
| `connections` | Initial connections, kept in process memory |
| `connectionProvider` | A host implementation that resolves connections per call. Cannot be combined with `connections` |
| `credentialBroker` | Signs requests in the host for plugins that declare their credential |
| `onAction` | Observes every action call |
| `timeoutMs`, `memoryLimitBytes` | Default limits for each run: 30 seconds and 64 MB |
| `maxRunsPerWorker` | Runs one worker serves before it is replaced. The default is 500 |

`addPlugin(plugin, connections?)` registers another plugin and replaces the worker so that later runs see it. `actions()`, `plugins()`, and `connections()` report what the instance holds. `connections()` lists only in-memory connections.

`dispose()` stops the pooled worker. Call it when a long-lived instance is no longer needed. An idle worker does not keep the process alive.

## Execute code

`execute(code, options)` runs one string of code and returns an `ExecuteResult`:

| Field | Contents |
|---|---|
| `result` | The value the code returned, converted to JSON |
| `error` | The error text, present when the run failed, timed out, or exceeded its memory limit |
| `logs` | Captured console lines, each prefixed with its level |

`execute()` does not reject when the code fails. Check `error`.

Pass `timeoutMs` or `memoryLimitBytes` to override the instance defaults for one run. A `timeoutMs` of `0` disables the timeout.

Pass `context` to deliver a value to every action called during the run:

```typescript
const outcome = await runline.execute(code, {
  context: { userId: "u_123" },
});
```

Actions read it as `ctx.context`. The code being run cannot see or change it, so a host can use it to carry the identity a run acts for.

Concurrent calls to `execute()` run in separate workers. See [Run Code](usage.md) for what the code can use.

## Load plugins

Pass plugin functions directly when the host bundles them. To load the plugins that ship with runline, use `discoverPlugins()` and name the ones you want:

```typescript
import { discoverPlugins, Runline } from "runline";

const plugins = await discoverPlugins(null, {
  builtinAllowlist: new Set(["github", "slack"]),
});

const runline = Runline.create({
  plugins,
  connections: [{ name: "gh", plugin: "github", config: { token } }],
});
```

`discoverPlugins(configDir, options)` returns plugins from a project's `.runline` folder when one is given and trusted, from the user's `~/.runline/plugins/` folder, from configured packages when `packages` is supplied, and from the bundled set. Bundled plugins outside `builtinAllowlist` are not imported. Pass `userDir` to read a folder other than `~/.runline`.

Each discovered plugin carries `sourceInfo` with its module path, origin, scope, and owner. Plugins the host constructs itself have none.

## Load a project

`Runline.fromProject(dir)` builds an instance from the nearest `.runline` folder at or above `dir`, as the command-line interface does. It returns `null` when there is none.

```typescript
const runline = await Runline.fromProject(process.cwd());
```

It registers the project's plugin files and packages when the project is trusted, the user's plugins and packages, and the bundled plugins that the project's connections name. Connections are read from and written to the project's `config.json`. It never installs a missing package.

| Option | Purpose |
|---|---|
| `trust` | Decides whether the project's plugins and packages load. The default reads `trust.json` in `userDir` |
| `userDir` | The user's runline folder. The default is `~/.runline` |
| `packages` | A `PackageManager` to load packages with, or `false` to load none |

See [Supply trust from a host](security.md#supply-trust-from-a-host).

## Supply connections

A `ConnectionProvider` resolves the connection for each action call. Implement one when connections live in the host's own storage or differ per user:

```typescript
import type { ConnectionProvider } from "runline";

const provider: ConnectionProvider = {
  async resolve({ plugin, context }) {
    const { userId } = context as { userId: string };
    const name = `${plugin}:${userId}`;
    return {
      read: async () => ({ name, plugin, config: await store.read(userId, plugin) }),
      update: async (change) => ({
        name,
        plugin,
        config: await store.update(userId, plugin, change),
      }),
    };
  },
};

const runline = Runline.create({ plugins, connectionProvider: provider });
```

`resolve()` receives the plugin name, the action, the plugin's connection schema, the plugin's `owner`, and the run's `context`. Throw from it to refuse the call. Runline does not fall back to environment variables or files.

The returned handle stays bound to one connection. `read()` returns a snapshot. `update()` applies a patch, or runs an updater function against freshly read config while holding ownership of the connection, and returns the committed snapshot. Plugins use it to store renewed tokens, so coordinate it across every writer that shares the storage.

An optional `failed(error)` method on the handle is called once when an action that used the connection throws. Use it to mark a connection whose credential was refused.

Return `owner` on a connection made for a plugin from a package. Runline refuses a connection whose owner differs from the plugin's. See [Understand names and connections](packages.md#understand-names-and-connections).

`MemoryConnectionProvider` and `FileConnectionProvider` are the two built-in implementations. Only `FileConnectionProvider` fills missing fields from environment variables.

## Sign requests in the host

By default a plugin signs requests with the secret in its connection. A host that keeps secrets outside the process running plugin code passes `credentialBroker`:

```typescript
const runline = Runline.create({
  plugins,
  connectionProvider: provider,
  credentialBroker: ({ plugin, action, context }) => ({
    request: (request) => signer.send({ plugin, action, context, request }),
    probe: () => signer.probe({ plugin, context }),
  }),
});
```

Runline calls the function once per action call of a plugin that declares its credential and passes the result to the action as `ctx.credentials`. The plugin then sends every request through it, and its connection config holds public settings only.

The broker authorizes and signs. Take the credential declaration from the plugin definition the host loaded, never from the calling process. See [Sign requests from a host](credentials.md#sign-requests-from-a-host) for the signing primitives.

## Observe action calls

`onAction` runs in the host process after each action's `execute` function settles:

```typescript
const runline = Runline.create({
  plugins,
  onAction: ({ path, durationMs, error }) => {
    metrics.record(path, durationMs, error === undefined);
  },
});
```

It receives `plugin`, `action`, `path`, `durationMs`, and `error` when the action threw. Calls to unknown actions and calls rejected by input validation never reach plugin code and are not reported. An exception thrown by the observer is ignored.

## Manage packages

`PackageManager` installs, updates, and loads plugin packages with storage, folders, the process runner, and trust supplied by the host. See [Embed the package manager](packages.md#embed-the-package-manager).

## Understand the limits

The SDK runs plugin code in the host process and calling code in a worker thread of the same process. Neither is isolated from the host. To run untrusted code, isolate the process that embeds runline. See [Security](security.md).
