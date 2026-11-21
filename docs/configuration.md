# Configuration

Codemode supports user-level and project configuration. User-level configuration lives in `~/.codemode`. Project configuration lives in a `.codemode` folder, which `codemode init` creates.

The command-line interface uses the nearest `.codemode` folder at or above the working directory. A project's plugins and packages load only after [project trust](security.md#understand-project-trust) is granted. Its connections and settings are data and load without it.

## User folder

| Path | Responsibility |
|---|---|
| `~/.codemode/config.json` | Packages installed for every project, and the `packageManager` setting |
| `~/.codemode/plugins/` | [Plugins](plugins.md) available in every project |
| `~/.codemode/packages/` | Files of installed [packages](packages.md). Managed by codemode |
| `~/.codemode/trust.json` | The project folders you trusted |

## Project `.codemode` folder

| Path | Responsibility |
|---|---|
| `.codemode/config.json` | [Connections](connections.md), settings, and the project's packages |
| `.codemode/plugins/` | Project plugins |
| `.codemode/plugins.json` | Paths of plugin modules that live outside the `plugins` folder |
| `.codemode/packages/` | Files of packages installed with `--local`. Managed by codemode |

`config.json` can hold secrets. Codemode writes it readable only by your account. Keep it out of version control, or keep the secrets in environment variables.

## Settings

Settings are top-level keys of `config.json`:

```json
{
  "connections": [
    { "name": "gh", "plugin": "github", "config": { "token": "ghp_example" }, "owner": "builtin" }
  ],
  "packages": ["npm:@example/codemode-orders@1.2.0"],
  "timeoutMs": 30000,
  "memoryLimitBytes": 67108864
}
```

| Setting | Type | Default | Description |
|---|---|---|---|
| `connections` | array | `[]` | Connections, each with `name`, `plugin`, `config`, and an optional `owner`. Manage them with `codemode connection` and `codemode auth` |
| `packages` | array | `[]` | Package sources, or objects with `source` and a `plugins` filter. Manage them with `codemode install` and `codemode remove` |
| `timeoutMs` | number | `30000` | Time limit for one run in milliseconds. `0` disables it |
| `memoryLimitBytes` | number | `67108864` | Memory limit for one run. Values below 8 MB are raised to 8 MB |
| `maxRunsPerWorker` | number | `500` | Runs one worker thread serves before codemode replaces it |
| `replaceableBuiltins` | `string[]` | `[]` | Bundled plugins that a local plugin of the same name may replace |
| `packageManager` | `"npm" \| "pnpm" \| "bun"` | `"npm"` | The program that installs npm packages. Read from `~/.codemode/config.json` only |

Codemode adds a `generation` value to each connection it writes, to tell one login from a later one with the same name.

Other tools keep their own keys in the same file. `pi-runline` reads `piPlugins` and `showStatus`.

## Environment variables

| Variable | Description |
|---|---|
| `CODEMODE_PACKAGE_MANAGER` | Overrides `packageManager`: `npm`, `pnpm`, or `bun` |
| `CODEMODE_OFFLINE` | Set to `1` to disable every network step of package commands |
| `CODEMODE_OAUTH_CALLBACK_PORT` | Port for the `codemode auth` redirect. The default is `47823` |
| `NO_COLOR` | Disables colored output, like `--no-color` |

Plugins name their own variables for connection fields, such as `GITHUB_TOKEN`. Codemode reads one when the connection does not set that field. See [Use environment variables](connections.md#use-environment-variables).

Code run by `codemode exec` does not receive the environment. See [Understand the runtime](usage.md#understand-the-runtime).
