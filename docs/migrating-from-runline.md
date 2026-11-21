# Migrate from runline

Codemode is runline under a new name. The package, the command, the folders, and the exported names changed in 0.46.0. Nothing about how plugins, connections, or runs work changed with them.

The runline names keep working until 0.48.0. Codemode reports each one it meets, once per process, with the name that replaces it. Migrate before upgrading to 0.48.0.

## Rename everything

| Runline | Codemode |
|---|---|
| npm package `runline` | `@shiftlabs/codemode` |
| Command `runline` | `codemode` |
| Folders `.runline/` and `~/.runline/` | `.codemode/` and `~/.codemode/` |
| `import … from "runline"` | `import … from "@shiftlabs/codemode"` |
| `import … from "runline/utils/cli"` | `import … from "@shiftlabs/codemode/utils/cli"` |
| `Runline`, `RunlineOptions`, `RunlineExecuteOptions`, `RunlineConfig` | `Codemode`, `CodemodeOptions`, `CodemodeExecuteOptions`, `CodemodeConfig` |
| `RunlinePluginAPI` | `CodemodePluginAPI` |
| `PackageManager.forRunlineFolders()` | `PackageManager.forCodemodeFolders()` |
| `RUNLINE_PACKAGE_MANAGER`, `RUNLINE_OFFLINE`, `RUNLINE_OAUTH_CALLBACK_PORT` | `CODEMODE_PACKAGE_MANAGER`, `CODEMODE_OFFLINE`, `CODEMODE_OAUTH_CALLBACK_PORT` |
| `"runline": { "plugins": [...] }` in `package.json` | `"codemode": { "plugins": [...] }` |
| Peer dependency `runline` | `@shiftlabs/codemode` |
| npm keyword `runline-plugin` | `codemode-plugin` |

## Migrate a project

Install the new package and rename the folders:

```bash
npm uninstall -g runline
npm install -g @shiftlabs/codemode
mv .runline .codemode
mv ~/.runline ~/.codemode
```

A project you trusted as `.runline` stays trusted after the rename. Connections, packages, and settings move with the folder.

Then change the imports in your plugins:

```typescript
import type { CodemodePluginAPI } from "@shiftlabs/codemode";
```

Run any command and check stderr. A line that says a name "is a runline name" points at something still to rename.

## Migrate an application

Replace the dependency and the imports:

```bash
npm uninstall runline
npm install @shiftlabs/codemode
```

```typescript
import { Codemode } from "@shiftlabs/codemode";

const codemode = Codemode.create({ plugins });
```

A host that passes folders itself, through `userDir` or `PackageManager` roots, keeps the folders it passes. Only the default locations changed.

## Understand what keeps working until 0.48.0

- The `runline` package on npm forwards to `@shiftlabs/codemode` and exports the runline names. Its `runline` command prints a notice and runs `codemode`.
- A `.runline` folder is used where no `.codemode` folder sits beside it.
- A plugin's `import … from "runline"` resolves to codemode.
- The `runline` key in a package's `package.json` is read where there is no `codemode` key.
- The `RUNLINE_*` environment variables are read where the `CODEMODE_*` ones are unset.

`codemode search` finds packages by the `codemode-plugin` keyword only. Add it to a package published with `runline-plugin`.

## Understand what did not move

`pi-runline`, the Pi extension, keeps its name and lives at [Michaelliv/pi-runline](https://github.com/Michaelliv/pi-runline). It runs runline 0.45 and reads only `.runline` folders, so keep a project's folder named `.runline` while you use the project from Pi.
