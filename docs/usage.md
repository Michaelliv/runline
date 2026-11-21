# Run Code

`runline exec` runs JavaScript that calls actions. The same code works through the SDK's `execute()` method and the `execute_runline` tool in Pi, so this page applies to all three.

If you have not installed runline or added a connection yet, follow the [Quickstart](quickstart.md).

## Write the code

Runline runs the code as the body of an async function. Use `await` for action calls and `return` for the result:

```bash
runline exec 'return await github.issue.get({ owner: "nodejs", repo: "node", issueNumber: 1 })'
```

Code can also be a single arrow function, which runline calls:

```bash
runline exec 'async () => { return await node.os.platform(); }'
```

Use `--file` or `-f` to run a file instead of an inline string:

```bash
runline exec -f ./scripts/triage.js
```

## Call actions

Each loaded plugin is a global. Follow it with the action name and pass one input object:

```javascript
const issue = await github.issue.create({
  owner: "acme",
  repo: "api",
  title: "Login fails for SSO users",
  labels: ["bug"],
});
return issue.number;
```

`actions.github.issue.create(input)` is the same call. Every action returns a promise.

When an action declares a TypeBox schema, runline validates the input before the action runs and rejects an invalid call with the validation errors. An action declared with the older field-map schema receives its input unvalidated, so check it with `actions.check()` first. An action that fails rejects with the plugin's error message, which code can catch.

In `runline exec`, a bundled plugin is loaded only when a connection names it. Code that uses a plugin without a connection fails with `<plugin> is not defined`. Plugins from your `plugins` folders and from packages are always loaded.

## Discover actions

The `actions` object describes what is loaded. Use it instead of guessing names and inputs:

| Call | Result |
|---|---|
| `actions.list()` | Every action path, such as `github.issue.create` |
| `actions.list("github")` | The paths of one plugin |
| `actions.find("create issue", limit)` | Ranked matches with `path`, `access`, `description`, and `score`; five by default |
| `actions.describe("github.issue.create")` | `path`, `plugin`, `action`, `access`, `description`, `signature`, and `inputs` |
| `actions.check("github.issue.create", input)` | `ok`, `missing`, `unknown`, `typeErrors`, `errors`, and `signature` |

`actions.check()` validates input against the action's schema and does not call the action:

```bash
runline exec 'return actions.check("github.issue.create", { owner: "acme" })'
```

`actions.describe()` throws for an unknown path and names the closest matches. `actions.check()` returns `ok: false` with `suggestions` instead.

A reliable order is `find`, then `describe`, then `check`, then the call.

## Read results and logs

`runline exec` prints the returned value to stdout. Strings print as they are, and other values print as indented JSON. A run that returns nothing prints nothing.

Calls to `console.log`, `console.warn`, `console.error`, `console.info`, and `console.debug` are captured and printed to stderr, each prefixed with its level.

Add `--json` for one machine-readable object:

```bash
runline exec 'console.log("checking"); return { ok: true }' --json
```

```json
{
  "result": { "ok": true },
  "logs": ["[log] checking"]
}
```

A failed run prints `{ "error", "logs" }` and exits with status 1. Results are converted to JSON, so a `Date` arrives as a string and a `Map` does not survive.

## List actions without running code

`runline actions` prints every action that runline can load, with its access label and inputs. This includes bundled plugins that have no connection:

```bash
runline actions
runline actions --connected
runline actions --json
```

`--connected` limits the list to plugins with a connection. `--json` includes each action's input schema.

## Understand the runtime

Code runs in a Node.js worker thread, not in the process that runs actions.

| Available in code | Behavior |
|---|---|
| Plugin globals and `actions` | Call and inspect actions |
| `console` | Captured into the run's logs |
| `require` | Loads Node.js built-in modules and modules resolvable from the working directory |
| `fetch` | Disabled. Throws when called |
| `process.env` | Empty. The host's environment is not passed to the worker |
| `process.exit()` | Throws. Return a value instead |

Runline stops a run after `timeoutMs`, 30 seconds by default, and when it exceeds `memoryLimitBytes`, 64 MB by default. Set either in [`config.json`](configuration.md#settings).

The worker is a convenient place to run code, not a security boundary. Code can load `node:fs` and `node:child_process` through `require`. Add a connection for the bundled `node` plugin when code should reach the filesystem, processes, or the network through labeled actions such as `node.fs.readFile` and `node.fetch`. See [Security](security.md).
