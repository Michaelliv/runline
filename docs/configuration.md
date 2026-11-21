# Configuration

Runline supports user-level and project configuration. User-level configuration lives in `~/.runline`. Project configuration lives in a `.runline` folder, which `runline init` creates.

The command-line interface uses the nearest `.runline` folder at or above the working directory. A project's plugins and packages load only after [project trust](security.md#understand-project-trust) is granted. Its connections and settings are data and load without it.

## User folder

| Path | Responsibility |
|---|---|
| `~/.runline/config.json` | Packages installed for every project, and the `packageManager` setting |
| `~/.runline/plugins/` | [Plugins](plugins.md) available in every project |
| `~/.runline/packages/` | Files of installed [packages](packages.md). Managed by runline |
| `~/.runline/trust.json` | The project folders you trusted |

## Project `.runline` folder

| Path | Responsibility |
|---|---|
| `.runline/config.json` | [Connections](connections.md), settings, and the project's packages |
| `.runline/plugins/` | Project plugins |
| `.runline/plugins.json` | Paths of plugin modules that live outside the `plugins` folder |
| `.runline/packages/` | Files of packages installed with `--local`. Managed by runline |

`config.json` can hold secrets. Runline writes it readable only by your account. Keep it out of version control, or keep the secrets in environment variables.

## Settings

Settings are top-level keys of `config.json`:

```json
{
  "connections": [
    { "name": "gh", "plugin": "github", "config": { "token": "ghp_example" }, "owner": "builtin" }
  ],
  "packages": ["npm:@example/runline-orders@1.2.0"],
  "timeoutMs": 30000,
  "memoryLimitBytes": 67108864
}
```

| Setting | Type | Default | Description |
|---|---|---|---|
| `connections` | array | `[]` | Connections, each with `name`, `plugin`, `config`, and an optional `owner`. Manage them with `runline connection` and `runline auth` |
| `packages` | array | `[]` | Package sources, or objects with `source` and a `plugins` filter. Manage them with `runline install` and `runline remove` |
| `timeoutMs` | number | `30000` | Time limit for one run in milliseconds. `0` disables it |
| `memoryLimitBytes` | number | `67108864` | Memory limit for one run. Values below 8 MB are raised to 8 MB |
| `maxRunsPerWorker` | number | `500` | Runs one worker thread serves before runline replaces it |
| `replaceableBuiltins` | `string[]` | `[]` | Bundled plugins that a local plugin of the same name may replace |
| `packageManager` | `"npm" \| "pnpm" \| "bun"` | `"npm"` | The program that installs npm packages. Read from `~/.runline/config.json` only |

Runline adds a `generation` value to each connection it writes, to tell one login from a later one with the same name.

Other tools keep their own keys in the same file. `pi-runline` reads `piPlugins` and `showStatus`.

## Environment variables

| Variable | Description |
|---|---|
| `RUNLINE_PACKAGE_MANAGER` | Overrides `packageManager`: `npm`, `pnpm`, or `bun` |
| `RUNLINE_OFFLINE` | Set to `1` to disable every network step of package commands |
| `RUNLINE_OAUTH_CALLBACK_PORT` | Port for the `runline auth` redirect. The default is `47823` |
| `NO_COLOR` | Disables colored output, like `--no-color` |

Plugins name their own variables for connection fields, such as `GITHUB_TOKEN`. Runline reads one when the connection does not set that field. See [Use environment variables](connections.md#use-environment-variables).

Code run by `runline exec` does not receive the environment. See [Understand the runtime](usage.md#understand-the-runtime).
