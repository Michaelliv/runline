# Packages

A runline package is an ordinary npm package or git repository that carries one or more plugins. Anyone can publish one; a person installs it with one command, and runline loads its plugins next to the bundled ones.

Package management is a library. The `runline` CLI is one consumer of `PackageManager`; a host that embeds runline is another, with its own storage, folders, process runner and trust policy.

## Install and manage

```bash
runline install npm:@acme/runline-orders@1.2.0      # pinned
runline install npm:@acme/runline-orders            # follows latest
runline install git:github.com/acme/runline-tools@v1
runline install https://github.com/acme/runline-tools
runline install ./tools/orders                      # loaded in place, never copied

runline list                  # configured packages, per scope
runline list --outdated       # newer versions for unpinned packages
runline update [source]       # move unpinned packages
runline remove <source>       # entry and installed files
runline search orders         # npm packages with the runline-plugin keyword
runline exec -e npm:@acme/runline-orders '…'   # load for one run only
```

Before recording a package, `runline install` shows each plugin, how many of its actions read and write, and which hosts its credential reaches, then asks. `--yes` skips the question.

Installs go to `~/.runline` by default. `--local` (`-l`) records the package in the project's `.runline` instead; that also trusts the project. A project's packages load only once the project is trusted: `runline trust [dir]`, `runline trust --revoke`.

`runline plugin install` is `install --yes` into the project (`--global` for `~/.runline`); `plugin remove` removes from the project, else from `~/.runline`. Plugins that `plugin install` recorded in `plugins.json` up to runline 0.44 still load; remove them by editing that file.

## Sources

| Source | Example | Identity |
|---|---|---|
| npm | `npm:@acme/orders@1.2.0` | `npm:@acme/orders` |
| git | `git:github.com/acme/tools@v1`, `https://…`, `ssh://…`, `git@host:o/r`, `file://…` | `git:github.com/acme/tools` |
| local | `./tools/orders`, `/abs/path`, `~/x` | the absolute path |

The ref is not part of a package's identity: installing `@v2` of a package that is configured at `@v1` replaces the entry. The same package in the user and project config loads once, from the project.

| Source | `runline update` |
|---|---|
| `npm:pkg@1.2.0` | stays (exact versions are pinned) |
| `npm:pkg@^1.2.0` | newest matching the range |
| `npm:pkg` | latest |
| `git:…@<tag or commit>` | stays |
| `git:…@<branch>`, `git:…` | the branch's head |
| local | never touched |

## Configuration

Packages are recorded under `"packages"` in `config.json`, next to connections:

```json
{
  "connections": [],
  "packages": [
    "npm:@acme/runline-orders@1.2.0",
    { "source": "git:github.com/acme/tools@v3", "plugins": ["!legacy"] }
  ]
}
```

The object form narrows which of a package's plugins load (`!name` excludes one); it cannot load a plugin the package does not declare.

Files live in managed folders, never in a plugin folder:

```text
~/.runline/packages/npm/            private package.json, node_modules/<package>
~/.runline/packages/git/<host>/<path>
<project>/.runline/packages/…       the same, for project scope
```

`RUNLINE_PACKAGE_MANAGER` (or `"packageManager"` in `~/.runline/config.json`) picks `npm` (default), `pnpm` or `bun`. `RUNLINE_OFFLINE=1` turns every network step off.

## Writing a package

```json
{
  "name": "@acme/runline-orders",
  "version": "1.2.0",
  "type": "module",
  "keywords": ["runline-plugin"],
  "runline": { "plugins": ["./dist/orders.js", "./dist/billing.js"] },
  "peerDependencies": { "runline": "*" },
  "dependencies": { "fast-xml-parser": "^5.0.0" }
}
```

- `runline.plugins` lists plugin modules relative to the package root. Globs (`*`, `**`) and `!exclusions` work; a path that leaves the package, through `..` or a symlink, is refused. Without the key, runline loads `main`, then `index.{ts,js}`, then `src/index.{ts,js}`.
- Each plugin module default-exports a plugin function or definition, as in [Writing a Plugin](../README.md#writing-a-plugin), and **declares its name**. A packaged plugin may not take a bundled plugin's name: the name selects the connection, and so the credentials. Two packages declaring one name: the second is refused.
- runline supplies `runline` (with `runline/utils/cli` and `runline/utils/http`) and `typebox` to every plugin. List them in `peerDependencies` with `"*"`; never in `dependencies`, which draws a warning. Other runtime imports go in `dependencies`; each package resolves only its own.
- Install scripts never run (`--ignore-scripts`). Publish built files.
- The `runline-plugin` keyword makes the package show up in `runline search`.

## The library

```ts
import { FilePackageStore, PackageManager, Runline } from "runline";

const pm = new PackageManager({
  roots: { user: "/data/runline", project: "/work/.runline" },
  store: new FilePackageStore({ user: "/data/runline/config.json" }),
  trust: async (projectRoot) => false,
  onMissing: "skip",                  // "install" | "skip" | "error" | (source, scope) => …
  onEvent: (event) => log(event),     // start / complete / error per source
});

const staged = await pm.fetch("npm:@acme/runline-orders@1.2.0");
const report = await pm.inspect(staged);   // plugins, read/write actions, credential targets, problems
if (acceptable(report)) await pm.commit(staged);
else await pm.discard(staged);

const { plugins, problems } = await pm.load();
const runline = Runline.create({ plugins, connectionProvider });
```

| Method | Does |
|---|---|
| `fetch(source, { scope })` | Fetch into the scope's managed folder without recording it |
| `inspect(staged \| source)` | What the package carries and asks for |
| `commit(staged)` / `discard(staged)` | Record it, or remove its files |
| `install(source, { scope })` | `fetch` + `commit` |
| `remove(source, { scope })` | Entry and managed files, matched by identity |
| `update(source?)` / `checkUpdates()` | Move unpinned packages / say what would move |
| `list()` | Configured packages and what is on disk |
| `load({ temporary? })` | `{ plugins, loaded, problems }`; never throws for a bad package |
| `search(terms)` | npm packages with the keyword |

Methods that fetch, run npm or git, or load plugins take `{ signal }`. Failures are `PackageError` with a `code` (`invalid_source`, `not_found`, `missing_path`, `install_failed`, `registry_failed`, `invalid_manifest`, `invalid_config`, `load_failed`, `name_reserved`, `name_conflict`, `untrusted`, `offline`, `aborted`, `unsafe_path`); `isPackageError` recognises one from any copy of runline.

`discard` puts back the version or ref the scope records when the fetch replaced it. A pinned npm package whose installed version differs from its entry counts as missing on `load`. A temporary local source must be absolute.

| Option | Default | Replace it to |
|---|---|---|
| `roots` | none: the library reads no folder it is not given | point at a tenant's or workspace's data folder |
| `store` | — (`FilePackageStore` over config.json, `MemoryPackageStore`) | keep entries in your own database |
| `runner` | argv spawns through `node:child_process` | run npm and git in a sandbox, or refuse them |
| `packageManager` | `npm` | use `pnpm` or `bun` |
| `trust` | refuse project scope | apply your own policy |
| `onMissing` | `"skip"`: a host never installs unless it asks | install on load, as the CLI does |
| `reservedNames` | the bundled plugins' names | reserve your host's own plugin names too: pass `[...bundledPluginNames(), ...yours]` (the option replaces the default) |
| `offline`, `fetch`, `registry`, `loadPlugin` | — | — |

`PackageManager.forRunlineFolders({ roots, ...options })` builds a manager over folders laid out as the CLI keeps them (entries in each root's `config.json`); the CLI and `Runline.fromProject` both use it.

`Runline.fromProject(dir, { trust, userDir, packages })` loads configured packages too, never installing; project packages only when `trust` allows. `discoverPlugins` takes `packages` as a manager or as a `load()` result already in hand.
