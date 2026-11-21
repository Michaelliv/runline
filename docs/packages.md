# Packages

Packages install and distribute codemode plugins through npm or git. Use a package when a plugin should be shared with other people or projects, or when several plugins belong together.

A package is an ordinary npm package or directory. It names its plugin modules under the `codemode` key in `package.json` and carries its own runtime dependencies.

## Install and manage packages

Install from npm, git, or a local path:

```bash
codemode install npm:@example/codemode-orders@1.2.0
codemode install git:github.com/example/codemode-tools@v1
codemode install ./tools/orders
```

Before recording a package, codemode lists its plugins, how many of their actions read and write, and the hosts their credentials are sent to, then asks for confirmation. Add `--yes` or `-y` to skip the question. Without a terminal, `--yes` is required.

| Task | Command |
|---|---|
| Install a package | `codemode install <source>` |
| List configured packages | `codemode list` |
| Show packages with newer versions | `codemode list --outdated` |
| Update all packages, or one | `codemode update [source]` |
| Remove a package and its entry | `codemode remove <source>` |
| Find packages on npm | `codemode search [terms]` |

Personal installs are recorded in `~/.codemode/config.json`. Add `--local` or `-l` to record the package in the project's `.codemode/config.json` instead. Codemode loads a project's packages only after the project is trusted, and `install --local` trusts the project it installs into. See [Project trust](security.md#understand-project-trust).

Use `--package` or `-e` to load a package for one invocation without recording it:

```bash
codemode exec -e npm:@example/codemode-orders 'return await orders.list({})'
```

`codemode plugin install <source>` is `codemode install --local --yes`; add `--global` for a personal install. See [Command Line](cli.md#package-commands) for every package command and option.

## Choose a source

| Source | Example | Behavior |
|---|---|---|
| npm | `npm:@example/codemode-orders@1.2.0` | Installed under `packages/npm` in the scope's `.codemode` folder |
| git | `git:github.com/example/codemode-tools@v1` | Cloned under `packages/git` and reconciled to the selected ref |
| URL | `https://github.com/example/codemode-tools` | Treated as a git source; `ssh://`, `git://`, and `file://` also work |
| Local | `./tools/orders` | Loaded from the resolved path without copying |

Exact npm versions are pinned. A range such as `^1.2.0` moves to the newest version inside it, and a bare name follows `latest`. A git source follows its ref: a branch moves, while a tag or commit stays where it is.

Codemode treats an npm package as missing when its installed version is outside the configured version or range. The CLI installs it again on the next run.

Relative local paths resolve from the `.codemode` folder whose configuration records them. A file path loads one plugin module. A directory follows the package rules below.

## Create a package

Name each plugin module under the `codemode` key:

```json
{
  "name": "@example/codemode-orders",
  "version": "1.2.0",
  "type": "module",
  "keywords": ["codemode-plugin"],
  "codemode": {
    "plugins": ["./dist/orders.js", "./dist/billing.js"]
  },
  "peerDependencies": { "@shiftlabs/codemode": "*" },
  "dependencies": { "fast-xml-parser": "^5.0.0" }
}
```

Paths are relative to the package root. The array accepts `*`, `**`, and `?` patterns and `!` exclusions; patterns skip dot-prefixed entries and `node_modules`. Codemode refuses a path that leaves the package, including through a symlink.

Without `codemode.plugins`, codemode loads the module named by `main`, then `src/index.ts` or `src/index.js`, then `index.ts` or `index.js`.

Each module default-exports a plugin, as described in [Plugins](plugins.md). A packaged plugin must set its name and register at least one action. Codemode does not fall back to the file name, because two packages would both become `index`.

Codemode loads TypeScript and JavaScript modules directly. It never runs install scripts, so a package that needs a build step must publish the built files.

The `codemode-plugin` keyword makes an npm package appear in `codemode search`.

## Declare dependencies

Put packages that a plugin imports at runtime in `dependencies`. Codemode installs them when it installs an npm or git source. It does not install or modify a local package, so that package's dependencies remain its author's responsibility.

Codemode supplies these modules to every plugin from its own copy:

- `@shiftlabs/codemode` and `@shiftlabs/codemode/utils/cli`
- `typebox`, `typebox/value`, and `typebox/compile`

Declare `@shiftlabs/codemode` and `typebox` in `peerDependencies` with a `"*"` range. Codemode does not install peers.

Do not list them in `dependencies`. An installed copy gives the plugin its own credential transport and error classes, separate from the ones codemode uses, and codemode reports a warning when it finds one.

A narrower peer range, such as `">=0.45"`, is compared with the codemode that loads the package. Outside the range the package still loads, and codemode reports a warning naming both versions.

## Select package plugins

The object form in `config.json` narrows which plugins load from a package:

```json
{
  "packages": [
    "npm:@example/codemode-orders@1.2.0",
    { "source": "git:github.com/example/codemode-tools@v1", "plugins": ["!legacy"] }
  ]
}
```

- Omit `plugins` to load every plugin the package declares.
- List names to load only those plugins.
- Use `!name` to leave one plugin out.

The filter narrows the package. It cannot load a plugin the package does not declare.

## Understand names and connections

A plugin's name selects its connection, and so its credentials. Codemode therefore decides who may hold a name:

- A packaged plugin cannot take the name of a bundled plugin. Codemode reports it and does not load it.
- When two packages declare the same name, the first one keeps it. Codemode reports the second and names both sources.
- A plugin file in a `plugins` folder takes precedence over a packaged plugin with the same name.

A connection belongs to the plugin source it was made for. `codemode connection add` and `codemode auth` record that source as the connection's `owner`: `builtin`, `local`, or the package identity.

A packaged plugin uses only connections made for its package. Codemode refuses a connection made for another package, or for a bundled or local plugin with the same name, and names both in the error. Add the connection again to use it with the new plugin. Removing a package leaves its connections in place.

This keeps a connection with the plugin it was made for. It is not a sandbox: plugin code runs inside the codemode process with that process's permissions. Review third-party package source before installing it. See [Security](security.md).

## Understand scope and identity

The same package can appear in personal and project configuration. Codemode loads it once, from the project entry when the project is trusted.

Codemode identifies npm packages by name, git packages by host and repository path without the ref, and local packages by resolved absolute path. SSH and HTTPS URLs for one repository are the same package. Installing another version or ref of a configured package replaces its entry.

Files are kept in managed folders that codemode never scans for plugins:

```text
~/.codemode/packages/npm/              one private npm project per scope
~/.codemode/packages/git/<host>/<path>
<project>/.codemode/packages/          the same layout, for project installs
```

Set `packageManager` in `~/.codemode/config.json`, or `CODEMODE_PACKAGE_MANAGER`, to `npm`, `pnpm`, or `bun`. The default is `npm`. Set `CODEMODE_OFFLINE=1` to disable every network step. See [Configuration](configuration.md).

## Embed the package manager

`PackageManager` is the library behind the commands above. Use it when a host installs or loads packages itself:

```typescript
import { FilePackageStore, PackageManager, Codemode } from "@shiftlabs/codemode";

const packages = new PackageManager({
  roots: { user: "/data/codemode" },
  store: new FilePackageStore({ user: "/data/codemode/config.json" }),
});

const staged = await packages.fetch("npm:@example/codemode-orders@1.2.0");
const report = await packages.inspect(staged);
if (report.problems.some((problem) => problem.level === "error")) {
  await packages.discard(staged);
} else {
  await packages.commit(staged);
}

const { plugins, problems } = await packages.load();
const codemode = Codemode.create({ plugins });
```

`fetch()` installs the package without recording it. `inspect()` imports its plugin modules and returns what the installation prompt shows. `commit()` records the package, and `discard()` removes it or restores the version the scope already records.

The manager reads no folder it was not given, and it never prompts, prints, or exits. Each boundary can be supplied explicitly:

- `roots` names the `.codemode` folders for the `user` and `project` scopes.
- `store` reads and writes package entries. `FilePackageStore` keeps them in `config.json`; `MemoryPackageStore` keeps them in memory.
- `runner` runs npm and git. Replace it to run them in a sandbox or to refuse them.
- `packageManager` selects `npm`, `pnpm`, or `bun`.
- `trust` decides whether the project scope can install and load. Without it, the project scope is refused.
- `onMissing` decides what `load()` does with a configured package that is not installed. The default is `"skip"`, so a host never installs unless it asks.
- `reservedNames` replaces the set of names packages cannot declare. Include `bundledPluginNames()` to keep the bundled names reserved.
- `onEvent`, `offline`, `fetch`, `registry`, and `loadPlugin` report progress, disable network steps, and replace the registry client and module loader.

`PackageManager.forCodemodeFolders()` builds a manager over folders laid out as the CLI keeps them. `Codemode.fromProject()` uses it to load configured packages without installing any.

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
| `search(terms)` | npm packages with the `codemode-plugin` keyword |

`load()` does not throw for a broken package. It returns the plugins that loaded and a `problems` array for the rest. Each loaded plugin carries `sourceInfo` with its package source, scope, and identity.

Other failures are `PackageError` values with a `code`, such as `invalid_source`, `install_failed`, `untrusted`, or `offline`. Use `isPackageError()` to recognize one. Methods that install or load accept an `AbortSignal` as `signal`.

A host that stores connections itself returns `owner` from its `ConnectionProvider` for plugins that came from packages. `ConnectionRequest.owner` carries the owner of the plugin that is asking.
