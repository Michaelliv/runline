# pi-runline

`pi-runline` is a [Pi](https://pi.dev) extension that adds [runline](../../README.md) to an agent as one tool. The agent writes JavaScript that calls runline actions, and discovers those actions from inside the code it runs.

Use it when a Pi agent should work with services such as GitHub, Slack, or Linear without a separate tool for each endpoint.

## Install

Install the extension as a Pi package:

```bash
pi install npm:pi-runline
```

The extension activates in a folder that has a `.runline` folder at or above it. Create one with the runline command-line interface:

```bash
npm install -g runline
runline init
```

## Choose plugins

Run `/runline-plugins` in a Pi session to choose which plugins the agent is told about:

```text
/runline-plugins
```

The picker lists every bundled plugin and the plugin files in the project and in `~/.runline/plugins/`. Nothing is enabled until you choose.

| Key | Action |
|---|---|
| Type | Filter the list |
| `Up`, `Down` | Move the highlight |
| `Space` | Enable or disable the highlighted plugin |
| `Alt+R` | Enter new credentials for the highlighted plugin |
| `Enter` | Save |
| `Escape` | Cancel |

After you save, the extension offers to set up each newly enabled plugin that needs credentials and has no connection. It asks for each field of the plugin's connection schema and writes the connection to `.runline/config.json`. It skips a plugin whose required fields are all set through environment variables.

Runline loads a bundled plugin only when the project has a connection for it. For a plugin that needs no credentials, or takes them from the environment, add the connection yourself:

```bash
runline connection add node --plugin node
```

Plugins that use OAuth are connected with `runline auth <plugin>`. See [Connections](../../docs/connections.md).

## Understand what the agent receives

At the start of a session, the extension loads the project with the runline SDK and adds one message to the conversation. The message names the enabled plugins and explains how to discover and call actions.

The agent then uses a single tool:

| Tool | Behavior |
|---|---|
| `execute_runline` | Runs JavaScript in the runline runtime. Each loaded plugin is a global, `return` produces the result, and console output is returned as logs |

The agent finds actions from inside that code instead of reading schemas from its prompt:

```javascript
actions.find("create issue");
actions.describe("github.issue.create");
actions.check("github.issue.create", { owner: "acme" });
return await github.issue.create({ owner: "acme", repo: "api", title: "Bug" });
```

See [Run Code](../../docs/usage.md) for the calling conventions and the runtime.

## Configure the extension

The extension keeps two keys in the project's `.runline/config.json`, next to runline's own settings:

```json
{
  "piPlugins": ["github", "linear", "slack"],
  "showStatus": true
}
```

| Key | Default | Description |
|---|---|---|
| `piPlugins` | None | The plugins named to the agent. `/runline-plugins` writes it |
| `showStatus` | `true` | Shows the number of enabled plugins and actions in Pi's status line |

To use one runline project from every folder, name it in `~/.pi/agent/runline.json`:

```json
{
  "project": "~/Projects/my-runline-project"
}
```

The extension uses this project when the working folder has no `.runline` folder at or above it.

## Understand the limits

`piPlugins` controls what the agent is told about, not what it can call. The runtime holds every plugin runline loads for the project: its plugin files, its packages, and the bundled plugins that have a connection. An agent that guesses the name of a loaded plugin that is not in `piPlugins` can still call it. Remove a plugin's connection, file, or package to make it unreachable.

Runline loads the project's own plugin files and packages only after the project is trusted. Run `runline trust` in a project that `runline init` did not create.

Actions run with the permissions of the Pi process, and actions that write run without asking. See [Security](../../docs/security.md).
