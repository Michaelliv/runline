# How Runline Works

Runline loads plugins, resolves a connection for each action call, and executes caller-supplied JavaScript that reaches those actions through globals. A plugin is a named set of actions. An action is a function with a description, an input schema, and a read or write label.

Code and actions run in different places. Code runs in a worker thread. Actions run in the host process, where the connection and its credentials live.

## Plugins and actions

A plugin registers actions under a name that is a JavaScript identifier, such as `github`. Action names are relative to the plugin and can contain dots, so the action `issue.create` in the plugin `github` is called as `github.issue.create()`.

An action declares its input with a TypeBox schema. Runline validates input against it before the action runs, and uses the same schema for discovery and for `actions.check()`. Actions declared with the older field-map schema are described and checked the same way, but their input is not validated before they run.

Runline finds plugins in four places: a trusted project's `.runline` folder, the user's `~/.runline` folder, installed packages, and the plugins bundled with runline. The first plugin to claim a name keeps it. See [Plugins](plugins.md#understand-how-plugins-load).

## Execution

A run starts with a string of JavaScript. Runline wraps it in an async function, sends it to a worker thread, and waits for the value it returns.

Inside the worker, each loaded plugin is a proxy. Calling `github.issue.create(input)` sends the action path and input to the host process and returns a promise for the result. The host finds the action, validates the input, resolves the connection, and calls the action's `execute` function.

Results cross the thread boundary as JSON. A run ends with its result, or an error, and the lines it logged. Runline stops a run that exceeds its timeout or memory limit.

The worker is reused across runs for speed and retired when a run leaves state behind. It is not a sandbox. See [Security](security.md).

## Connections and credentials

A connection names a plugin and holds its configuration. Runline resolves a connection each time an action is called, through a connection provider.

The command-line interface stores connections in `.runline/config.json`. The SDK keeps them in memory by default, and a host can supply its own provider to resolve connections per call from its own storage.

A plugin that calls an authenticated API declares its credential: what the secret is, how it is placed in a request, and which HTTPS targets may receive it. Runline signs each request from that declaration, renews expired tokens, and refuses requests outside the declared targets. A host can sign requests itself, so the process that runs plugin code never holds the secret. See [Credentials](credentials.md).

## Discovery

Code inspects the loaded actions through the `actions` object in the worker. `actions.find()` searches by text, `actions.describe()` returns an action's signature and inputs, and `actions.check()` validates input without calling the action.

This keeps action schemas out of an agent's prompt. The agent searches for what it needs, checks its call, and then makes it, all through one tool.

## Interfaces

The command-line interface loads the nearest `.runline` folder and runs code with `runline exec`. The TypeScript SDK creates a `Runline` instance in process, with plugins and connections supplied by the host or loaded from a project folder. The `pi-runline` extension exposes one tool to Pi that runs code through the SDK.

All interfaces use the same engine, plugins, and connection contract.

## Packages

A package distributes plugins through npm or git. Runline installs packages into folders it manages, never runs their install scripts, and records them in `config.json`. A connection belongs to the plugin source it was made for, so a package cannot inherit another plugin's credentials by reusing its name. See [Packages](packages.md).

## Trust and permissions

Runline loads a project's plugin files and packages only after the project is trusted. Plugins and packages in the user's own folder load without a trust decision.

Plugins execute inside the runline process with its operating-system permissions. Trust decides whether code loads. It does not restrict that code afterward.
