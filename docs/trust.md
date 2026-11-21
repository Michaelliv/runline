# Project Trust

Project trust controls whether runline loads code from a project's `.runline` folder. It prevents a folder from running plugin code the first time a command runs inside it.

Plugins run inside the runline process with the permissions of the account that started it. Trust a project only when you would run its code yourself.

## Understand what trust protects

Runline requires trust before it loads these resources from a project:

- plugin files and folders under `.runline/plugins/`
- plugins listed in `.runline/plugins.json`
- packages recorded in the project's `.runline/config.json`, including installing them

Without trust, runline imports none of them. It reports that the project's plugins were skipped and continues with everything else.

These load regardless of project trust:

- the project's connections and settings in `.runline/config.json`, which are data
- plugins and packages in your own `~/.runline` folder
- the bundled plugins

A project is a `.runline` folder other than `~/.runline`. Your own folder never needs trust.

## Trust a project

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

## Supply trust from a host

`Runline.fromProject()` and `discoverPlugins()` read the same `trust.json` from their `userDir`, so a host and the CLI agree by default. Pass `trust` to decide another way:

```typescript
const runline = await Runline.fromProject(projectDir, {
  trust: (projectRoot) => approvedProjects.has(projectRoot),
});
```

`PackageManager` reads no folder it was not given. Without a `trust` option it refuses the project scope. Pass the same function to the manager and to discovery so that a project's plugin files and packages follow one decision.

Use `isProjectTrusted()` and `setProjectTrusted()` to read and record decisions in a user folder.

## Understand the limits

Project trust is not a sandbox. It decides whether code loads, and does nothing to limit that code afterward.

- A trusted plugin can read files, start processes, and reach the network with the permissions of the runline process.
- `runline install` imports a package's plugin modules to build the summary it shows, before it asks for confirmation. Install scripts do not run.
- Binding a connection to its plugin's owner prevents another plugin from inheriting it by name. It does not stop code in the same process from reading `config.json` directly.

Agent code passed to `runline exec` runs in a worker thread with an empty environment, and plugin `execute` handlers run in the host process. Neither is a security boundary.

Review a package's source before installing it, and a project's `.runline/plugins/` folder before trusting it.
