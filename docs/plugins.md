# Plugins

A plugin is a TypeScript or JavaScript module that registers actions under one name. Write a plugin to give code access to an API or a host capability that the [bundled plugins](bundled-plugins.md) do not cover.

Plugins run inside the runline process with its permissions. To share a plugin with other people or projects, publish it as a [package](packages.md).

## Create a plugin

Put the module in a `plugins` folder. Runline loads `.runline/plugins/` from a trusted project and `~/.runline/plugins/` for every project:

```text
.runline/plugins/weather.ts
```

The module default-exports a function that receives the plugin API and registers actions:

```typescript
import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";

export default function weather(rl: RunlinePluginAPI) {
  rl.setName("weather");
  rl.setVersion("1.0.0");

  rl.registerAction("forecast.get", {
    access: "read",
    description: "Get the current temperature at a coordinate.",
    inputSchema: t.Object(
      {
        latitude: t.Number({ minimum: -90, maximum: 90 }),
        longitude: t.Number({ minimum: -180, maximum: 180 }),
      },
      { additionalProperties: false },
    ),
    async execute({ latitude, longitude }) {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      url.searchParams.set("current", "temperature_2m");
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`weather: request failed (HTTP ${response.status})`);
      return response.json();
    },
  });
}
```

Runline loads the file directly, with no build step. The imports of `runline` and `typebox` resolve to the copies runline itself uses, so the plugin folder needs no `node_modules`.

Call the action:

```bash
runline exec 'return await weather.forecast.get({ latitude: 52.52, longitude: 13.41 })'
```

`runline init` trusts the project it creates. In a project created another way, run `runline trust` before its plugins load. See [Project trust](security.md#understand-project-trust).

## Define actions

`registerAction(name, definition)` adds one action. The name is relative to the plugin and can contain dots, so `forecast.get` in the plugin `weather` is called as `weather.forecast.get()`. Do not repeat the plugin name in it.

| Field | Purpose |
|---|---|
| `access` | `"read"` for actions that only retrieve data. `"write"` for anything that creates, changes, deletes, sends, executes, or may otherwise affect a system |
| `description` | One sentence that code sees in `actions.find()` and `actions.describe()` |
| `inputSchema` | A TypeBox object schema. Runline validates input against it before `execute` runs |
| `execute(input, ctx)` | The implementation. Its return value is the action's result |

Set `additionalProperties: false` on the input schema so a misspelled field is rejected instead of ignored.

Name each input as the provider's own reference names that parameter, in camelCase. Linear's `issue(id:)` becomes `linear.issue.get({ id })`, and AgentMail's `inbox_id` becomes `inboxId`. An agent that knows the API then already knows the action, and a value the provider returns can be passed back under the same name.

Return plain data. Results are converted to JSON before they reach the caller. Throw an `Error` to fail the call; the caller receives its message.

`execute` receives a context as its second argument:

| Property | Contents |
|---|---|
| `ctx.connection` | The resolved connection, with its `config` |
| `ctx.context` | A value the host passed to `execute()` for this run, invisible to the calling code |
| `ctx.credentials` | The host's request signer, when the host keeps credentials outside this process |
| `ctx.log` | `info`, `warn`, and `error`, prefixed with the plugin name |
| `ctx.updateConnection(patch)` | Persists a change to the connection's config through the host |

## Declare a connection

A plugin that needs configuration declares a connection schema. Each field can name the environment variable that supplies it:

```typescript
rl.setConnectionSchema(
  t.Object({
    apiKey: t.String({ env: "ORDERS_API_KEY", description: "Orders API key" }),
    region: t.Optional(t.Union([t.Literal("us"), t.Literal("eu")])),
  }),
);
```

The values arrive in `ctx.connection.config`. See [Connections](connections.md) for how a user supplies them.

## Authenticate requests

A plugin that calls an authenticated API declares its credential and sends requests through runline's helpers. It does not read the secret or build an `Authorization` header:

```typescript
import { credentialJson, pathSegment, type RunlinePluginAPI, staticCredential } from "runline";
import * as t from "typebox";

const credential = staticCredential({
  id: "orders",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: { baseUrl: "https://api.orders.example/v1/", methods: ["GET"] },
  },
});

export default function orders(rl: RunlinePluginAPI) {
  rl.setName("orders");
  rl.setVersion("1.0.0");
  rl.setCredential(credential);
  rl.setConnectionSchema(t.Object({ apiKey: t.String({ env: "ORDERS_API_KEY" }) }));

  rl.registerAction("list", {
    access: "read",
    description: "List an organization's orders, newest first.",
    inputSchema: t.Object(
      { orgId: t.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    execute: ({ orgId }, ctx) =>
      credentialJson(ctx, credential, "orders", {
        target: "api",
        path: `orgs/${pathSegment(orgId)}/orders`,
      }),
  });
}
```

The declaration states what the secret is, how it is placed, and the HTTPS targets that may receive it. Runline refuses any request outside those targets. A host that keeps credentials elsewhere signs the same requests without the plugin changing.

[Credentials](credentials.md) covers every kind of declaration, including OAuth, AWS, and cookie sessions, and the request and error helpers.

## Understand how plugins load

Runline looks for plugins in this order:

1. A trusted project's `.runline/plugins/` folder, then the paths in its `.runline/plugins.json`
2. `~/.runline/plugins/`
3. Installed [packages](packages.md)
4. The plugins bundled with runline

The first plugin with a name keeps it, and runline reports later duplicates on stderr. A plugin that does not call `setName` is named after its module file, which for a folder is `index`, so always set the name.

A plugin's name is a variable in the code that calls it. It must be a JavaScript identifier, and it cannot be a reserved word or one of the runtime's own names: `actions`, `console`, `fetch`, `require`, and `FerroSearch`. Runline refuses a plugin with any other name when it loads.

A `plugins` folder accepts these layouts:

| Entry | Loaded module |
|---|---|
| `orders.ts` or `orders.js` | The file |
| `orders/` with a `package.json` that sets `main` | The `main` module |
| `orders/` with a `package.json` that sets `runline.plugins` | Every listed module, under the [package rules](packages.md#create-a-package) |
| `orders/` otherwise | The first of `src/index.ts`, `src/index.js`, `index.ts`, and `index.js` |

Runline skips entries whose names start with `_` or `.`, and files ending in `.d.ts` or `.test.ts`.

`plugins.json` lists modules that live elsewhere. Relative paths resolve from the `.runline` folder:

```json
{
  "plugins": [{ "path": "../tools/orders.ts" }]
}
```

A bundled plugin's name is protected, because the name selects the connection and so the credentials. A local plugin named like a bundled plugin is not loaded unless `config.json` lists that name:

```json
{
  "replaceableBuiltins": ["github"]
}
```

A broken plugin does not stop the others from loading. Runline reports the module's path and the reason on stderr and continues.

## Understand where plugin code runs

Plugin modules and their `execute` functions run in the host process, with full access to Node.js and to the dependencies the host process can resolve. Calling code runs in a separate worker thread and reaches a plugin only through its actions.

Loading a plugin runs its module. Keep work out of the module's top level and out of the registration function, which runs on every start.

A module can also default-export a plain object with `name`, `version`, and `actions`. The function form is preferred because it gives the module the typed plugin API.

## Debug a plugin

List what loaded and where it came from, then inspect one action from inside a run:

```bash
runline plugin list
runline exec 'return actions.describe("weather.forecast.get")'
runline exec 'return actions.check("weather.forecast.get", { latitude: 52.52 })'
```

`runline actions --json` prints every loaded action with its schema. Load failures appear on stderr with the module path. Common causes are a name that cannot be a variable, a missing entry point, a malformed `package.json` or `plugins.json`, an untrusted project, and a name that another plugin already holds.

## Share a plugin

Publish plugins as a package to install them with `runline install`. A package names its plugin modules in `package.json` and carries its own dependencies. See [Packages](packages.md).

To add a plugin to the bundled set, see [`packages/runline-plugins`](../packages/runline-plugins/README.md).
