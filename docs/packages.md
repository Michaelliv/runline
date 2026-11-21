# Packages

Packages install and distribute runline plugins through npm or git. Use a package when a plugin should be shared with other people or projects, or when several plugins belong together.

A package is an ordinary npm package or directory. It names its plugin modules under the `runline` key in `package.json` and carries its own runtime dependencies.

## Install and manage packages

Install from npm, git, or a local path:

```bash
runline install npm:@example/runline-orders@1.2.0
runline install git:github.com/example/runline-tools@v1
runline install ./tools/orders
```

Before recording a package, runline lists its plugins, how many of their actions read and write, and the hosts their credentials are sent to, then asks for confirmation. Add `--yes` or `-y` to skip the question. Without a terminal, `--yes` is required.

| Task | Command |
|---|---|
| Install a package | `runline install <source>` |
| List configured packages | `runline list` |
| Show packages with newer versions | `runline list --outdated` |
| Update all packages, or one | `runline update [source]` |
| Remove a package and its entry | `runline remove <source>` |
| Find packages on npm | `runline search [terms]` |

Personal installs are recorded in `~/.runline/config.json`. Add `--local` or `-l` to record the package in the project's `.runline/config.json` instead. Runline loads a project's packages only after the project is trusted, and `install --local` trusts the project it installs into. See [Project trust](security.md#understand-project-trust).

Use `--package` or `-e` to load a package for one invocation without recording it:

```bash
runline exec -e npm:@example/runline-orders 'return await orders.list({})'
```

`runline plugin install <source>` is `runline install --local --yes`; add `--global` for a personal install. See [Command Line](cli.md#package-commands) for every package command and option.

## Choose a source

| Source | Example | Behavior |
|---|---|---|
| npm | `npm:@example/runline-orders@1.2.0` | Installed under `packages/npm` in the scope's `.runline` folder |
| git | `git:github.com/example/runline-tools@v1` | Cloned under `packages/git` and reconciled to the selected ref |
| URL | `https://github.com/example/runline-tools` | Treated as a git source; `ssh://`, `git://`, and `file://` also work |
| Local | `./tools/orders` | Loaded from the resolved path without copying |

Exact npm versions are pinned. A range such as `^1.2.0` moves to the newest version inside it, and a bare name follows `latest`. A git source follows its ref: a branch moves, while a tag or commit stays where it is.

Runline treats an npm package as missing when its installed version is outside the configured version or range. The CLI installs it again on the next run.

Relative local paths resolve from the `.runline` folder whose configuration records them. A file path loads one plugin module. A directory follows the package rules below.

## Create a package

Name each plugin module under the `runline` key:

```json
{
  "name": "@example/runline-orders",
  "version": "1.2.0",
  "type": "module",
  "keywords": ["runline-plugin"],
  "runline": {
    "plugins": ["./dist/orders.js", "./dist/billing.js"]
  },
  "peerDependencies": { "runline": "*" },
  "dependencies": { "fast-xml-parser": "^5.0.0" }
}
```

Paths are relative to the package root. The array accepts `*`, `**`, and `?` patterns and `!` exclusions; patterns skip dot-prefixed entries and `node_modules`. Runline refuses a path that leaves the package, including through a symlink.

Without `runline.plugins`, runline loads the module named by `main`, then `index.ts` or `index.js`, then `src/index.ts` or `src/index.js`.

Each module default-exports a plugin, as described in [Plugins](plugins.md). A packaged plugin must set its name and register at least one action. Runline does not fall back to the file name, because two packages would both become `index`.

Runline loads TypeScript and JavaScript modules directly. It never runs install scripts, so a package that needs a build step must publish the built files.

The `runline-plugin` keyword makes an npm package appear in `runline search`.

## Declare dependencies

Put packages that a plugin imports at runtime in `dependencies`. Runline installs them when it installs an npm or git source. It does not install or modify a local package, so that package's dependencies remain its author's responsibility.

Runline supplies these modules to every plugin from its own copy:

- `runline`, `runline/utils/cli`, and `runline/utils/http`
- `typebox`, `typebox/value`, and `typebox/compile`

Declare `runline` and `typebox` in `peerDependencies` with a `"*"` range. Runline does not install peers.

Do not list them in `dependencies`. An installed copy gives the plugin its own credential transport and error classes, separate from the ones runline uses, and runline reports a warning when it finds one.

A narrower peer range, such as `">=0.45"`, is compared with the runline that loads the package. Outside the range the package still loads, and runline reports a warning naming both versions.

## Select package plugins

The object form in `config.json` narrows which plugins load from a package:

```json
{
  "packages": [
    "npm:@example/runline-orders@1.2.0",
    { "source": "git:github.com/example/runline-tools@v1", "plugins": ["!legacy"] }
  ]
}
```

- Omit `plugins` to load every plugin the package declares.
- List names to load only those plugins.
- Use `!name` to leave one plugin out.

The filter narrows the package. It cannot load a plugin the package does not declare.

## Understand names and connections

A plugin's name selects its connection, and so its credentials. Runline therefore decides who may hold a name:

- A packaged plugin cannot take the name of a bundled plugin. Runline reports it and does not load it.
- When two packages declare the same name, the first one keeps it. Runline reports the second and names both sources.
- A plugin file in a `plugins` folder takes precedence over a packaged plugin with the same name.

A connection belongs to the plugin source it was made for. `runline connection add` and `runline auth` record that source as the connection's `owner`: `builtin`, `local`, or the package identity.

A packaged plugin uses only connections made for its package. Runline refuses a connection made for another package, or for a bundled or local plugin with the same name, and names both in the error. Add the connection again to use it with the new plugin. Removing a package leaves its connections in place.

This keeps a connection with the plugin it was made for. It is not a sandbox: plugin code runs inside the runline process with that process's permissions. Review third-party package source before installing it. See [Security](security.md).

## Understand scope and identity

The same package can appear in personal and project configuration. Runline loads it once, from the project entry when the project is trusted.

Runline identifies npm packages by name, git packages by host and repository path without the ref, and local packages by resolved absolute path. SSH and HTTPS URLs for one repository are the same package. Installing another version or ref of a configured package replaces its entry.

Files are kept in managed folders that runline never scans for plugins:

```text
~/.runline/packages/npm/              one private npm project per scope
~/.runline/packages/git/<host>/<path>
<project>/.runline/packages/          the same layout, for project installs
```

Set `packageManager` in `~/.runline/config.json`, or `RUNLINE_PACKAGE_MANAGER`, to `npm`, `pnpm`, or `bun`. The default is `npm`. Set `RUNLINE_OFFLINE=1` to disable every network step. See [Configuration](configuration.md).

## Embed the package manager

`PackageManager` is the library behind the commands above. Use it when a host installs or loads packages itself:

```typescript
import { FilePackageStore, PackageManager, Runline } from "runline";

const packages = new PackageManager({
  roots: { user: "/data/runline" },
  store: new FilePackageStore({ user: "/data/runline/config.json" }),
});

const staged = await packages.fetch("npm:@example/runline-orders@1.2.0");
const report = await packages.inspect(staged);
if (report.problems.some((problem) => problem.level === "error")) {
  await packages.discard(staged);
} else {
  await packages.commit(staged);
}

const { plugins, problems } = await packages.load();
const runline = Runline.create({ plugins });
```

`fetch()` installs the package without recording it. `inspect()` imports its plugin modules and returns what the installation prompt shows. `commit()` records the package, and `discard()` removes it or restores the version the scope already records.

The manager reads no folder it was not given, and it never prompts, prints, or exits. Each boundary can be supplied explicitly:

- `roots` names the `.runline` folders for the `user` and `project` scopes.
- `store` reads and writes package entries. `FilePackageStore` keeps them in `config.json`; `MemoryPackageStore` keeps them in memory.
- `runner` runs npm and git. Replace it to run them in a sandbox or to refuse them.
- `packageManager` selects `npm`, `pnpm`, or `bun`.
- `trust` decides whether the project scope can install and load. Without it, the project scope is refused.
- `onMissing` decides what `load()` does with a configured package that is not installed. The default is `"skip"`, so a host never installs unless it asks.
- `reservedNames` replaces the set of names packages cannot declare. Include `bundledPluginNames()` to keep the bundled names reserved.
- `onEvent`, `offline`, `fetch`, `registry`, and `loadPlugin` report progress, disable network steps, and replace the registry client and module loader.

`PackageManager.forRunlineFolders()` builds a manager over folders laid out as the CLI keeps them. `Runline.fromProject()` uses it to load configured packages without installing any.

| Method | Result |
|---|---|
| `fetch(source, { scope })` | A staged package on disk, not yet recorded |
| `inspect(staged)` | Plugins, action counts, credential targets, and problems |
| `commit(staged)`, `discard(staged)` | Record the staged package, or undo the fetch |
| `install(source, { scope })` | `fetch()` followed by `commit()` |
| `remove(source, { scope })` | Whether an entry and its files were removed |
| `update(source?)`, `checkUpdates()` | Versions before and after, or the updates available |
| `list()` | Configured packages and what is installed |
| `load({ temporary })` | Loaded plugins and the problems found |
| `search(terms)` | npm packages with the `runline-plugin` keyword |

`load()` does not throw for a broken package. It returns the plugins that loaded and a `problems` array for the rest. Each loaded plugin carries `sourceInfo` with its package source, scope, and identity.

Other failures are `PackageError` values with a `code`, such as `invalid_source`, `install_failed`, `untrusted`, or `offline`. Use `isPackageError()` to recognize one. Methods that install or load accept an `AbortSignal` as `signal`.

A host that stores connections itself returns `owner` from its `ConnectionProvider` for plugins that came from packages. `ConnectionRequest.owner` carries the owner of the plugin that is asking.
