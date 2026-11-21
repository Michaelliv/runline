# Run Runline Safely

Treat code passed to runline as untrusted when a model wrote it. That code can call every action of every loaded plugin with the connections you configured, and actions that write, send, or delete run without asking for approval.

Runline has no sandbox. Plugins run inside the runline process, and the worker thread that runs code can load Node.js modules. Project trust controls which project plugins load, but it does not limit what loaded code does.

Safety comes from limiting what the runline process can reach: the plugins it loads, the credentials it holds, and the files, processes, and network available to its operating-system user.

## Understand what runs where

| Code | Runs in | Can reach |
|---|---|---|
| Code passed to `runline exec` or `execute()` | A worker thread with an empty environment | Loaded actions, and Node.js modules through `require` |
| Plugin modules and their `execute` functions | The host process | Everything the process can: files, child processes, the network, and the host environment |
| Package installation | `npm` and `git` child processes | The network and the package folders. Install scripts do not run |

The worker thread keeps the host's environment variables and the channel to the host away from calling code, and it stops runs that exceed their time or memory limit. It is not a security boundary: code can read files and start processes through `require("node:fs")` and `require("node:child_process")`.

To run untrusted code, run runline inside a container, virtual machine, or other operating-system sandbox, and give that environment only the credentials and network access the task needs.

<a id="project-trust"></a>

## Understand project trust

Project trust controls whether runline loads code from a project's `.runline` folder. It prevents a folder from running plugin code the first time a command runs inside it.

A project is a `.runline` folder other than `~/.runline`. Your own folder never needs trust.

### Resources protected by project trust

Runline requires trust before it loads these resources from a project:

- plugin files and folders under `.runline/plugins/`
- plugins listed in `.runline/plugins.json`
- packages recorded in the project's `.runline/config.json`, including installing them

Without trust, runline imports none of them. It reports that the project's plugins were skipped and continues with everything else.

These load regardless of project trust:

- the project's connections and settings in `.runline/config.json`, which are data
- plugins and packages in your own `~/.runline` folder
- the bundled plugins

### Trust a project

Run `runline trust` inside the project, or name its directory:

```bash
runline trust
runline trust ~/work/billing
runline trust --revoke
```

Two commands record trust for you, because each is an explicit decision about that project:

- `runline init` trusts the `.runline` folder it creates.
- `runline install --local` trusts the project it installs into.

Decisions are stored by the resolved path of the `.runline` folder in:

```text
~/.runline/trust.json
```

Runline does not prompt for trust. A command in an untrusted project runs without the project's plugins until you trust it.

### Supply trust from a host

`Runline.fromProject()` and `discoverPlugins()` read the same `trust.json` from their `userDir`, so a host and the command-line interface agree by default. Pass `trust` to decide another way:

```typescript
const runline = await Runline.fromProject(projectDir, {
  trust: (projectRoot) => approvedProjects.has(projectRoot),
});
```

`PackageManager` reads no folder it was not given. Without a `trust` option it refuses the project scope. Pass the same function to the manager and to discovery so that a project's plugin files and packages follow one decision.

Use `isProjectTrusted()` and `setProjectTrusted()` to read and record decisions in a user folder.

## Protect credentials

The command-line interface stores connections as plain text in `.runline/config.json`, in a file readable only by your account.

- Keep secrets in environment variables, or keep `config.json` out of version control.
- Use narrowly scoped, short-lived credentials, and separate credentials for unattended runs.
- Prefer plugins that declare their credential. Runline sends a declared credential only to the HTTPS targets in the declaration, and keeps provider error text out of error messages. See [Credentials](credentials.md).
- When embedding runline, keep credentials in the host and sign requests through a credential broker, so the process that runs plugin code never holds them. See [Sign requests in the host](sdk.md#sign-requests-in-the-host).

A connection belongs to the plugin source it was made for, which prevents another plugin from inheriting it by name. It does not stop code in the same process from reading `config.json` directly.

## Review packages before installing them

A package's plugins run with the same permissions as any other plugin.

`runline install` lists a package's plugins, how many of their actions read and write, and the hosts their credentials are sent to, then asks for confirmation. To build that summary it imports the package's plugin modules, before it asks. Install scripts do not run.

Review a package's source before installing it, and a project's `.runline/plugins/` folder before trusting it. Pin an exact version or a commit when a package must not change underneath you. See [Packages](packages.md).

## Reduce impact and improve recovery

These practices do not replace isolation, but they reduce exposure:

- Add connections only for the plugins a task needs. `runline exec` loads a bundled plugin only when a connection names it.
- Add a `node` connection only when code should reach the filesystem, processes, and network through actions.
- Audit what ran. Every action carries a `read` or `write` label, and the SDK reports each action call to `onAction` after it settles.
- Review generated code before running it against an account that matters.
