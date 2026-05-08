# pi-runline

Code mode for [pi](https://github.com/mariozechner/pi).

An extension that plugs [runline](https://www.npmjs.com/package/runline) into coding agents. The agent gets one native tool, in-sandbox action discovery, a fuzzy picker for choosing which of the 202 built-in plugins to expose, and a guided credential prompt for the ones it hasn't seen before.

## Install

```bash
pi install pi-runline
```

## How the agent uses it

On session start, if the current working directory has a `.runline/` (or one is configured globally — see below), the extension registers a single tool and injects a short primer naming the enabled plugins:

- **`execute_runline`** — run JavaScript in runline's QuickJS sandbox. Every enabled plugin is a top-level global; `return` surfaces the result; logs are captured.

Discovery happens **inside the sandbox**, not as a separate tool. The agent uses an `actions` object to explore the catalog without paying for a full schema dump in its system prompt:

```js
actions.list()                  // every "plugin.action" path
actions.list("github")          // filter to one plugin
actions.find("create issue")    // ranked fuzzy search (MiniSearch)
actions.describe("github.issue.create")
// → { path, plugin, action, description, signature, inputs }
actions.check("github.issue.create", { owner: "a" })
// → { ok, missing, unknown, typeErrors, signature }   (does NOT call the action)
```

Unknown paths throw with did-you-mean suggestions, so typos are self-correcting. Recommended flow: `find` → `describe` → `check` → call.

Calling actions is unchanged — plugin globals and `actions.<plugin>.<action>(...)` are the same call:

```js
return await github.issue.create({ owner: "acme", repo: "api", title: "Bug" });
```

## `/runline-plugins` — the picker

Typing `/runline-plugins` in a pi session opens a fuzzy multi-select over all 202 built-in plugins.

```
╭─────────────────────────────────────────────╮
│ runline plugins · 5/202 enabled             │
│ type to filter · space toggle · ^A toggle   │
│                                             │
│ filter ❯ gith                               │
│                                             │
│ ❯ ◉ github       34 actions                 │
│   ◯ gitlab       17 actions                 │
│   ...                                       │
╰─────────────────────────────────────────────╯
```

Keys: `type` to filter · `↑/↓` to move · `space` to toggle · `Ctrl-A` to toggle all visible · `enter` to save · `esc` to cancel.

After saving, any newly-enabled plugin with a `connectionConfigSchema` that doesn't already have a connection (and can't be fully resolved from env vars) will prompt you field-by-field for credentials. Values are written to `.runline/config.json` under `connections[]`.

## Configuration

### Per-project — `.runline/config.json`

```json
{
  "showStatus": true,
  "piPlugins": ["github", "slack", "linear"],
  "connections": [
    { "name": "github", "plugin": "github", "config": { "token": "ghp_..." } }
  ]
}
```

- **`piPlugins`** — the allowlist the extension uses. If missing or empty, nothing is exposed to the agent and the status bar says `runline: /runline-plugins to enable`.
- **`showStatus`** — set to `false` to silence the status bar entry for this project.
- **`connections`** — standard runline connections (shared with the CLI and SDK).

### Global — `~/.pi/agent/runline.json`

```json
{ "project": "~/Projects/my-runline-project" }
```

Fallback used when the current cwd has no `.runline/` anywhere up the tree. Useful when you want the runline tools available in every pi session without scattering `.runline/` folders.

## How plugin allow-listing works

The extension deliberately exposes nothing by default. That's on purpose — 2,614 actions is a lot of context budget. You pick the plugins that matter for a given project, commit the allowlist to `.runline/config.json`, and the agent only ever sees the ones you enabled in its primer.

Note that the QuickJS sandbox itself still registers every runline plugin as a global (and `actions.list()` will surface them all), so in principle an agent could guess and call a disabled plugin. In practice the primer only advertises the allowlisted ones, and unconfigured plugins error out at first action call anyway. Plumbing the allowlist into the sandbox registry is on the roadmap.
